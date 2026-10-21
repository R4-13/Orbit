/**
 * Archiviert (reversibel) ausdrücklich benannte HubSpot-Testdeals, die ein Messlauf angelegt hat – nach Sicherung der Nachweise und Prüfung auf Fremdnutzung.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/archive-hubspot-testdeals.ts <tenant-slug> <dealId,dealId,…> --since <ISO> --contact <E-Mail des Testkontakts> --evidence <Datei.json> [--execute]
 *
 * ERST ANZEIGEN, DANN ÄNDERN. Ein Deal wird nur archiviert, wenn ALLE Prüfungen bestehen:
 *   1. er ist lesbar und wurde nach `--since` angelegt (durch den Messlauf neu),
 *   2. sein Name ist der automatisch vergebene Name („Anfrage (EMAIL)“),
 *   3. er ist nur mit EINEM Kontakt verknüpft, der der benannte Testkontakt ist – oder (der ORBIT-Vertriebsweg legt den Kontakt ohne E-Mail an) ein Kontakt ohne E-Mail, der zusammen mit dem Deal (±2 Minuten) nach `--since`
 *      angelegt wurde und nur mit diesem einen Deal verknüpft ist – und höchstens einem Unternehmen, ohne Notizen, Aufgaben, E-Mails, Meetings oder Anrufe,
 *   4. er ist von keiner Person bearbeitet (Änderung höchstens 10 Minuten nach der Anlage – automatische Ergänzungen von HubSpot –, keine Besitzerzuordnung, Standardphase der Standard-Pipeline),
 *   5. der Nachweis (vollständige Deal-Eigenschaften und Verknüpfungen) liegt vorher in der Nachweisdatei.
 * Archiviert wird per HubSpot-API `DELETE /crm/v3/objects/deals/{dealId}` (Archivieren; in HubSpot unter „Zuletzt gelöscht“ wiederherstellbar). Kontakte, Unternehmen und andere Geschäftsdaten bleiben erhalten.
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HubSpotService } from '../src/connectors/hubspot.service';
import { PrismaService } from '../src/prisma/prisma.service';

const HUBSPOT = 'https://api.hubapi.com';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [slug, dealList] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const sinceText = option('--since');
  const contactEmail = option('--contact')?.toLowerCase();
  const evidencePath = option('--evidence');
  const execute = process.argv.includes('--execute');
  const dealIds = (dealList ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  if (!slug || dealIds.length === 0 || !sinceText || !contactEmail || !evidencePath || dealIds.some((d) => !/^\d+$/.test(d))) throw new Error('Aufruf: archive-hubspot-testdeals.ts <tenant-slug> <dealId,…> --since <ISO> --contact <E-Mail> --evidence <Datei.json> [--execute]');
  const since = new Date(sinceText);
  if (Number.isNaN(since.getTime())) throw new Error('--since ist kein Zeitpunkt.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const tenant = await app.get(PrismaService).withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const hubspot = app.get(HubSpotService);
    if (!(await hubspot.isConnected(tenant.id))) throw new Error('HubSpot ist für diesen Betrieb nicht verbunden.');
    const headers = { Authorization: `Bearer ${await hubspot.tokenFor(tenant.id)}`, 'Content-Type': 'application/json' };
    const get = async (path: string) => {
      const response = await fetch(`${HUBSPOT}${path}`, { headers });
      return response.ok ? ((await response.json()) as Record<string, unknown>) : undefined;
    };

    const evidence: Array<Record<string, unknown>> = [];
    const approved: string[] = [];
    for (const dealId of dealIds) {
      const deal = (await get(`/crm/v3/objects/deals/${dealId}?properties=dealname,createdate,hs_lastmodifieddate,hubspot_owner_id,dealstage,pipeline,amount&archived=false`)) as { properties?: Record<string, string | null> } | undefined;
      const entry: Record<string, unknown> = { dealId, deal: deal ?? null };
      const checks: Array<[string, boolean]> = [['lesbar', Boolean(deal)]];
      if (deal?.properties) {
        const props = deal.properties;
        const created = props.createdate ? new Date(props.createdate) : undefined;
        const modified = props.hs_lastmodifieddate ? new Date(props.hs_lastmodifieddate) : undefined;
        const associations: Record<string, Array<{ toObjectId?: number | string }>> = {};
        for (const to of ['contacts', 'companies', 'notes', 'tasks', 'emails', 'meetings', 'calls']) {
          const result = (await get(`/crm/v4/objects/deals/${dealId}/associations/${to}`)) as { results?: Array<{ toObjectId?: number | string }> } | undefined;
          associations[to] = result?.results ?? [];
        }
        entry.associations = associations;
        // Der verknüpfte Kontakt muss der Testkontakt sein.
        let contactIsTest = false;
        const contactId = associations.contacts?.[0]?.toObjectId;
        if (associations.contacts?.length === 1 && contactId !== undefined) {
          const contact = (await get(`/crm/v3/objects/contacts/${contactId}?properties=email,createdate`)) as { properties?: { email?: string | null; createdate?: string | null } } | undefined;
          entry.contact = contact ?? null;
          const contactDeals = ((await get(`/crm/v4/objects/contacts/${contactId}/associations/deals`)) as { results?: unknown[] } | undefined)?.results ?? [];
          entry.contactDeals = contactDeals.length;
          const contactCreated = contact?.properties?.createdate ? new Date(contact.properties.createdate) : undefined;
          const email = contact?.properties?.email?.toLowerCase();
          const createdTogether = created !== undefined && contactCreated !== undefined && contactCreated.getTime() >= since.getTime() && Math.abs(contactCreated.getTime() - created.getTime()) < 120_000;
          contactIsTest = email === contactEmail || (!email && createdTogether && contactDeals.length === 1);
        }
        checks.push(
          ['nach --since angelegt', created !== undefined && created.getTime() >= since.getTime()],
          ['automatisch vergebener Name', /^Anfrage \(EMAIL\)$/.test(props.dealname ?? '')],
          ['nur mit dem Testkontakt (oder dem gleichzeitig angelegten E-Mail-losen Kontakt) verknüpft', contactIsTest],
          ['höchstens ein Unternehmen', (associations.companies?.length ?? 0) <= 1],
          ['keine Notizen/Aufgaben/E-Mails/Meetings/Anrufe', ['notes', 'tasks', 'emails', 'meetings', 'calls'].every((k) => (associations[k]?.length ?? 0) === 0)],
          ['von keiner Person bearbeitet (Änderung ≤ 10 Min. nach Anlage)', created !== undefined && modified !== undefined && modified.getTime() - created.getTime() < 600_000],
          ['ohne Besitzer, Standardphase', !props.hubspot_owner_id && props.pipeline === 'default' && props.dealstage === 'appointmentscheduled'],
        );
      }
      entry.checks = Object.fromEntries(checks);
      evidence.push(entry);
      const ok = checks.every(([, passed]) => passed);
      console.log(`Deal ${dealId} „${deal?.properties?.dealname ?? '?'}“: ${checks.map(([name, passed]) => `${passed ? '✔' : '✘'} ${name}`).join(' · ')} → ${ok ? 'darf archiviert werden' : 'BLEIBT'}`);
      if (ok) approved.push(dealId);
    }

    writeFileSync(evidencePath, JSON.stringify({ exportedAt: new Date().toISOString(), tenant: slug, evidence }, null, 2), 'utf8');
    console.log(`Nachweis gesichert: ${evidencePath}`);
    if (!execute) return void console.log('\nNur angezeigt. Zum Archivieren --execute angeben.');
    for (const dealId of approved) {
      const response = await fetch(`${HUBSPOT}/crm/v3/objects/deals/${dealId}`, { method: 'DELETE', headers: { Authorization: headers.Authorization } });
      console.log(`Deal ${dealId}: ${response.status === 204 ? 'archiviert (in HubSpot unter „Zuletzt gelöscht“ wiederherstellbar)' : `NICHT archiviert (HTTP ${response.status})`}`);
    }
    console.log(`${approved.length} von ${dealIds.length} Deal(s) archiviert; Kontakte, Unternehmen und andere Geschäftsdaten blieben unberührt.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
