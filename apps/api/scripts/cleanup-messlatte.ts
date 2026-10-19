/**
 * Bereinigt die Testdaten EINER Messung (Messlatte, Schattenbetrieb-Läufe) in einem Betrieb – eng begrenzt auf Vorgänge, die seit einem Zeitpunkt entstanden sind
 * UND an einer Nachricht des Test-Absenders hängen. Ablauf: ERST ZÄHLEN (ohne `--execute` ändert das Skript nichts), dann in dieser Reihenfolge:
 *
 *   1. automatische Folgeaktionen stoppen: Aufmerksamkeitshinweise (Erinnerungen/Eskalationen) beenden, Vorgänge abbrechen (offene Freigaben ungültig, Wartezeiten beendet),
 *   2. noch offene Freigaben dieser Vorgänge ausdrücklich ablehnen (nichts wird ausgeführt),
 *   3. zugeordnete Testdaten löschen: Aufgaben, Rechnungen, Anfragen (Leads), Freigaben, Vorgänge (mit Plänen, Fakten, Ereignissen, Entwürfen),
 *   4. HubSpot-Testeintrag (Deal) NUR entfernen, wenn er nachweislich durch die Messung neu angelegt wurde und nur mit dem Kontakt verknüpft ist.
 *
 * BLEIBEN: Eingänge (IntakeEvent) und Nachrichten (E-Mail) samt Dokumenten – sie sind der Nachweis der Messung und sichern gegen erneutes Einlesen derselben Mails aus dem
 * Postfach (die Abfrage des Postfachs erkennt Bekanntes an diesen Einträgen). Das Protokoll (Audit) wird nie verändert. Vorher sichern: scripts/backup-postgres.sh backup.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/cleanup-messlatte.ts <tenant-slug> --since 2026-10-18T16:39:00Z --sender tomorbit777@gmail.com [--execute]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { HubSpotService } from '../src/connectors/hubspot.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CaseLifecycleService } from '../src/process/case-lifecycle.service';
import { OrchestratorService } from '../src/process/orchestrator.service';

const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED']);
const HUBSPOT = 'https://api.hubapi.com';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const sinceText = option('--since');
  const sender = option('--sender')?.toLowerCase();
  const execute = process.argv.includes('--execute');
  if (!slug || !sinceText || !sender) throw new Error('Aufruf: cleanup-messlatte.ts <tenant-slug> --since <ISO> --sender <Adresse> [--execute]');
  const since = new Date(sinceText);
  if (Number.isNaN(since.getTime())) throw new Error('--since ist kein Zeitpunkt.');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const tenantId = tenant.id;

    // Umfang: Vorgänge ab `since`, an denen mindestens eine Nachricht des Test-Absenders hängt.
    const scope = await prisma.withRlsBypass(async (tx) => {
      const mails = await tx.emailMessage.findMany({ where: { tenantId, direction: 'INBOUND', fromAddress: { equals: sender, mode: 'insensitive' }, caseId: { not: null }, createdAt: { gte: since } }, select: { caseId: true } });
      const caseIds = [...new Set(mails.map((m) => m.caseId as string))];
      const cases = await tx.case.findMany({ where: { tenantId, id: { in: caseIds }, createdAt: { gte: since } }, select: { id: true, title: true, orchestrationStatus: true, blueprintKey: true } });
      const ids = cases.map((c) => c.id);
      const intents = await tx.actionIntent.findMany({ where: { tenantId, caseId: { in: ids } }, select: { id: true } });
      const invoices = await tx.invoice.findMany({ where: { tenantId, caseId: { in: ids } }, select: { id: true } });
      const leads = await tx.lead.findMany({ where: { tenantId, caseId: { in: ids } }, select: { id: true } });
      const approvalWhere = { tenantId, OR: [{ entityType: 'PROCESS_ACTION' as const, entityId: { in: intents.map((i) => i.id) } }, { entityType: 'INVOICE' as const, entityId: { in: invoices.map((i) => i.id) } }] };
      return {
        cases,
        ids,
        invoiceIds: invoices.map((i) => i.id),
        leadIds: leads.map((l) => l.id),
        approvalWhere,
        approvalsPending: await tx.approval.count({ where: { ...approvalWhere, status: 'PENDING' } }),
        approvalsAll: await tx.approval.count({ where: approvalWhere }),
        tasks: await tx.task.count({ where: { tenantId, caseId: { in: ids } } }),
        attention: await tx.attentionItem.count({ where: { tenantId, caseId: { in: ids }, state: { not: 'RESOLVED' } } }),
        retainedMails: await tx.emailMessage.count({ where: { tenantId, caseId: { in: ids } } }),
        retainedIntake: await tx.intakeEvent.count({ where: { tenantId, OR: [{ caseId: { in: ids } }, { createdAt: { gte: since }, emailMessage: { fromAddress: { equals: sender, mode: 'insensitive' } } }] } }),
      };
    });

    console.log(`Betrieb ${slug}: ${scope.cases.length} Vorgänge ab ${since.toISOString()} mit Nachricht von ${sender}:`);
    for (const c of scope.cases) console.log(`  ${c.id.slice(0, 8)}  ${c.orchestrationStatus.padEnd(22)} ${c.title}`);
    console.log(`Offene Freigaben: ${scope.approvalsPending} (insgesamt ${scope.approvalsAll}) · Aufgaben: ${scope.tasks} · Rechnungen: ${scope.invoiceIds.length} · Anfragen (Leads): ${scope.leadIds.length} · offene Hinweise: ${scope.attention}`);
    console.log(`Bleiben (Nachweis, Schutz vor erneutem Einlesen): ${scope.retainedMails} Nachrichten, ${scope.retainedIntake} Eingänge, Dokumente, Protokoll.`);

    // HubSpot: nur lesend prüfen, welche Deals die Anfragen angelegt haben.
    const audits = await prisma.withRlsBypass((tx) => tx.auditLog.findMany({ where: { tenantId, eventType: 'LEAD_CREATED', entityId: { in: scope.leadIds } }, select: { entityId: true, payload: true } }));
    const dealIds = audits.map((a) => (a.payload as { crmExternalId?: string } | null)?.crmExternalId).filter((x): x is string => typeof x === 'string');
    const hubspot = app.get(HubSpotService);
    const verified: string[] = [];
    if (dealIds.length > 0 && (await hubspot.isConnected(tenantId))) {
      const token = await hubspot.tokenFor(tenantId);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      for (const dealId of dealIds) {
        const deal = await fetch(`${HUBSPOT}/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=dealname,createdate&archived=false`, { headers });
        if (!deal.ok) {
          console.log(`HubSpot-Deal ${dealId}: nicht lesbar (${deal.status}) – bleibt unberührt.`);
          continue;
        }
        const body = (await deal.json()) as { properties?: { dealname?: string; createdate?: string } };
        const created = body.properties?.createdate ? new Date(body.properties.createdate) : undefined;
        const assoc = async (to: string) => {
          const response = await fetch(`${HUBSPOT}/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/${to}`, { headers });
          return response.ok ? (((await response.json()) as { results?: unknown[] }).results ?? []).length : -1;
        };
        const [contacts, companies, notes] = [await assoc('contacts'), await assoc('companies'), await assoc('notes')];
        const isNew = created !== undefined && created.getTime() >= since.getTime();
        const onlyContact = companies === 0 && notes === 0 && contacts >= 0;
        console.log(`HubSpot-Deal ${dealId} „${body.properties?.dealname ?? ''}“: angelegt ${created?.toISOString() ?? '?'}, neu durch die Messung: ${isNew ? 'ja' : 'NEIN'}, Verknüpfungen: Kontakte ${contacts}, Unternehmen ${companies}, Notizen ${notes} → ${isNew && onlyContact ? 'darf entfernt werden' : 'bleibt'}`);
        if (isNew && onlyContact) verified.push(dealId);
      }
    }

    if (!execute) return void console.log('\nNur angezeigt. Zum Bereinigen --execute angeben (vorher sichern).');

    const admin = await prisma.withRlsBypass((tx) => tx.user.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
    if (!admin) throw new Error('Kein Benutzer im Betrieb gefunden.');
    const orchestrator = app.get(OrchestratorService);
    const lifecycle = app.get(CaseLifecycleService);

    // 1. Folgeaktionen stoppen.
    const stopped = await prisma.withRlsBypass((tx) => tx.attentionItem.updateMany({ where: { tenantId, caseId: { in: scope.ids }, state: { not: 'RESOLVED' } }, data: { state: 'RESOLVED', resolvedAt: new Date() } }));
    console.log(`\n1. ${stopped.count} offene Hinweise beendet (keine Erinnerungen/Eskalationen mehr).`);
    let cancelled = 0;
    for (const c of scope.cases) {
      const fresh = await prisma.forTenantId(tenantId).case.findUnique({ where: { id: c.id }, select: { orchestrationStatus: true } });
      if (!fresh || TERMINAL.has(fresh.orchestrationStatus)) continue;
      const hasPlan = (await prisma.forTenantId(tenantId).processPlan.count({ where: { caseId: c.id } })) > 0;
      if (hasPlan) await orchestrator.cancel(tenantId, c.id, admin.id);
      else await lifecycle.transition(tenantId, c.id, { to: 'CANCELLED' }, { type: 'SYSTEM' });
      cancelled += 1;
    }
    console.log(`   ${cancelled} Vorgänge abgebrochen (Wartezeiten beendet, Freigaben ungültig).`);

    // 2. Verbliebene offene Freigaben ablehnen.
    const rejected = await prisma.withRlsBypass((tx) =>
      tx.approval.updateMany({ where: { ...scope.approvalWhere, status: 'PENDING' }, data: { status: 'REJECTED', decisionReason: 'Testfreigabe ungültig gemacht (Messlatte 18.10.2026); nichts wurde ausgeführt.', decidedAt: new Date() } }),
    );
    console.log(`2. ${rejected.count} offene Testfreigaben abgelehnt (nichts ausgeführt).`);

    // 3. Zugeordnete Testdaten löschen (Nachrichten, Eingänge und Dokumente bleiben).
    const removed = await prisma.withRlsBypass(async (tx) => {
      const approvals = await tx.approval.deleteMany({ where: scope.approvalWhere });
      const tasks = await tx.task.deleteMany({ where: { tenantId, caseId: { in: scope.ids } } });
      const proposals = await tx.bookingProposal.deleteMany({ where: { tenantId, invoiceId: { in: scope.invoiceIds } } });
      const invoices = await tx.invoice.deleteMany({ where: { tenantId, id: { in: scope.invoiceIds } } });
      const leads = await tx.lead.deleteMany({ where: { tenantId, id: { in: scope.leadIds } } });
      const cases = await tx.case.deleteMany({ where: { tenantId, id: { in: scope.ids } } });
      return { approvals: approvals.count, tasks: tasks.count, proposals: proposals.count, invoices: invoices.count, leads: leads.count, cases: cases.count };
    });
    console.log(`3. gelöscht: ${removed.cases} Vorgänge, ${removed.tasks} Aufgaben, ${removed.invoices} Rechnungen (${removed.proposals} Buchungsvorschläge), ${removed.leads} Anfragen, ${removed.approvals} Freigaben.`);

    // 4. HubSpot-Testeintrag.
    if (verified.length > 0) {
      const token = await hubspot.tokenFor(tenantId);
      for (const dealId of verified) {
        const response = await fetch(`${HUBSPOT}/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        console.log(`4. HubSpot-Deal ${dealId}: ${response.status === 204 ? 'entfernt (im HubSpot-Papierkorb wiederherstellbar)' : `NICHT entfernt (${response.status})`}`);
      }
    } else {
      console.log('4. Kein HubSpot-Eintrag entfernt.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
