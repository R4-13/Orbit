/**
 * Nachweis für die Abnahme des Meilensteins B (nur lesend): zeigt zu EINEM Vorgang die Falldaten, den Lead in ORBIT und den Lead **so, wie das CRM ihn jetzt liefert** (Rücklesen über denselben Anschluss, den ORBIT
 * verwendet – bei HubSpot `GET /crm/v3/objects/deals/{id}`), die zugestellten Rückmeldungen, die Aufgaben, die Freigaben und den Abschlussstatus. Ändert nichts.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/lead-readback.ts <tenant-slug> <volle-vorgangs-id> [--json]
 */
import { NestFactory } from '@nestjs/core';
import type { CrmConnector } from '@orbit/integration-core';
import { AppModule } from '../src/app.module';
import { CRM_CONNECTOR } from '../src/connectors/connectors.tokens';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [slug, caseId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const asJson = process.argv.includes('--json');
  if (!slug || !caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) throw new Error('Aufruf: lead-readback.ts <tenant-slug> <volle-vorgangs-id> [--json]');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const scoped = prisma.forTenantId(tenant.id);
    const row = await scoped.case.findUnique({ where: { id: caseId } });
    if (!row) throw new Error('Vorgang nicht gefunden.');
    const family = [caseId, ...(row.parentCaseId ? [row.parentCaseId] : [])];

    const facts = await scoped.caseFact.findMany({ where: { caseId }, orderBy: [{ key: 'asc' }, { revision: 'asc' }] });
    const lead = await scoped.lead.findFirst({ where: { caseId }, include: { contact: true } });
    let crmReadBack: { externalId: string; title?: string; notes?: string } | null | { error: string } = null;
    if (lead?.crmExternalId) {
      try {
        crmReadBack = await app.get<CrmConnector>(CRM_CONNECTOR).readLead({ tenantId: tenant.id, externalId: lead.crmExternalId });
      } catch (error) {
        crmReadBack = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    const messages = await scoped.emailMessage.findMany({ where: { caseId: { in: family } }, orderBy: { createdAt: 'asc' }, select: { direction: true, fromAddress: true, toAddresses: true, subject: true, bodyText: true, createdAt: true } });
    const tasks = await scoped.task.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, select: { title: true, status: true, description: true } });
    const intents = await scoped.actionIntent.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' }, select: { id: true, capabilityKey: true, purpose: true, status: true, nodeKey: true } });
    const approvals = await scoped.approval.findMany({ where: { entityId: { in: intents.map((i) => i.id) } }, select: { status: true, policyAction: true } });
    const events = await scoped.caseEvent.findMany({ where: { caseId, type: { in: ['lead.synced', 'lead.sync_failed', 'lead.sync_conflict', 'supplement.applied', 'supplement.confirmed', 'fact.corrected', 'fact.conflict_detected', 'completion.evaluated', 'case.completed'] } }, orderBy: { sequence: 'asc' }, select: { type: true, payload: true } });

    const report = {
      case: { id: row.id, title: row.title, status: row.orchestrationStatus, attentionReasons: row.attentionReasons, outcome: row.outcome, blueprint: `${row.blueprintKey ?? '-'} ${row.blueprintVersion ?? ''}`.trim() },
      facts: facts.map((f) => ({ key: f.key, value: f.value, status: f.status, current: f.isCurrent, revision: f.revision })),
      lead: lead ? { id: lead.id, crmExternalId: lead.crmExternalId, syncState: lead.crmSyncState, syncError: lead.crmSyncError, syncedAt: lead.crmSyncedAt, orbitNotes: lead.notes } : null,
      crmReadBack,
      messages: messages.map((m) => ({ direction: m.direction, from: m.fromAddress, to: m.toAddresses, subject: m.subject, body: m.bodyText, at: m.createdAt })),
      tasks,
      actions: intents,
      approvals,
      events,
    };
    if (asJson) return void console.log(JSON.stringify(report, null, 2));

    console.log(`== Vorgang ${row.id}\n${report.case.title} · ${report.case.status} · ${report.case.blueprint}\nHinweise: ${row.attentionReasons.join(' | ') || '-'}\nAbschluss: ${JSON.stringify(row.outcome)}`);
    console.log('\n== Falldaten (aktuell; frühere Fassungen mit „–“)');
    for (const f of facts) console.log(`${f.isCurrent ? ' ' : '–'} ${f.key} = ${JSON.stringify(f.value)} [${f.status}, Rev ${f.revision}]`);
    console.log('\n== Lead in ORBIT');
    console.log(lead ? `${lead.id} · CRM-Kennung ${lead.crmExternalId} · Abgleich ${lead.crmSyncState}${lead.crmSyncError ? ` (${lead.crmSyncError})` : ''}\n${lead.notes}` : '(kein Lead)');
    console.log('\n== Lead im CRM (zurückgelesen)');
    console.log(crmReadBack ? JSON.stringify(crmReadBack, null, 2) : '(nicht gelesen)');
    console.log('\n== Nachrichten');
    for (const m of messages) console.log(`${m.direction === 'INBOUND' ? '←' : '→'} ${m.direction === 'INBOUND' ? m.fromAddress : m.toAddresses.join(',')} · ${m.subject}\n${(m.bodyText ?? '').slice(0, 700)}\n`);
    console.log('== Aufgaben');
    for (const t of tasks) console.log(`- [${t.status}] ${t.title}`);
    console.log('\n== Wirkungen und Freigaben');
    for (const i of intents) console.log(`- ${i.nodeKey} ${i.capabilityKey}${i.purpose ? `/${i.purpose}` : ''}: ${i.status}`);
    console.log(`Freigaben: ${approvals.length} (${approvals.map((a) => `${a.policyAction}:${a.status}`).join(', ') || '-'})`);
    console.log(`\n== Ereignisse\n${events.map((e) => e.type).join(' ')}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
