/**
 * Gibt den wartenden Plan EINES ausdrücklich benannten Testvorgangs frei (Planfreigabe, Entscheidung D4) – für die Praxistests, die der Auftraggeber für einzelne, isolierte Testvorgänge
 * erlaubt hat. ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` zeigt das Skript nur die Wirkungen des Plans. Es gibt nur frei, wenn
 *   - der Vorgang ausdrücklich per ID benannt ist und einen wartenden Plan hat,
 *   - jede Wirkung des Plans eine E-Mail an die **Absenderadresse des Vorgangs** (nur `--only-to <Adresse>`), eine interne Meldung oder eine interne Aufgabe ist
 *     (kein Kalender, kein CRM, keine anderen Empfänger) – sonst bricht das Skript ab, ohne etwas freizugeben.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/approve-test-plan.ts <tenant-slug> <case-id> --only-to tomorbit777@gmail.com [--execute]
 */
import { NestFactory } from '@nestjs/core';
import { isEffectCapability, type PlanNode } from '@orbit/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapabilityRegistryService } from '../src/process/capability-registry.service';
import { OrchestratorService } from '../src/process/orchestrator.service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Erlaubte Wirkungen in Testvorgängen: Rückfrage/Antwort/Bestätigung per E-Mail (nur an die Absenderadresse des Vorgangs), interne Meldung, interne Aufgabe. */
const ALLOWED_EFFECTS = new Set(['email.send', 'staff.notify', 'task.create']);

async function main(): Promise<void> {
  const [slug, caseId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const onlyTo = option('--only-to')?.toLowerCase();
  const execute = process.argv.includes('--execute');
  if (!slug || !caseId || !onlyTo || !/^[0-9a-f-]{36}$/i.test(caseId)) throw new Error('Aufruf: approve-test-plan.ts <tenant-slug> <volle-vorgangs-id> --only-to <Adresse> [--execute]');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const scoped = prisma.forTenantId(tenant.id);
    const plan = await scoped.processPlan.findFirst({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { revision: 'desc' }, include: { nodes: true } });
    if (!plan) throw new Error('Der Vorgang hat keinen Plan, der auf die Freigabe wartet.');
    const sender = await scoped.emailMessage.findFirst({ where: { caseId, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' }, select: { fromAddress: true } });
    if (!sender || sender.fromAddress.toLowerCase() !== onlyTo) throw new Error(`Die Absenderadresse des Vorgangs (${sender?.fromAddress ?? 'unbekannt'}) ist nicht ${onlyTo}.`);

    const catalogue = app.get(CapabilityRegistryService).catalogue();
    const effects = plan.nodes
      .map((n) => n.definition as unknown as PlanNode)
      .filter((def) => def.type === 'ACTION' && def.capability && isEffectCapability(catalogue.get(def.capability.key)) || (def.type === 'ACTION' && def.capability && ALLOWED_EFFECTS.has(def.capability.key)))
      .map((def) => `${def.capability!.key}${typeof def.config.purpose === 'string' ? `/${def.config.purpose}` : ''}`);
    console.log(`Plan Revision ${plan.revision} des Vorgangs ${caseId.slice(0, 8)}: Ziele ${plan.goalKeys.join(', ')}`);
    console.log(`Schritte: ${plan.nodes.map((n) => `${n.nodeKey}:${n.state}`).join(' · ')}`);
    console.log(`Wirkungen: ${effects.join(', ') || '(keine)'}`);
    const forbidden = plan.nodes.map((n) => n.definition as unknown as PlanNode).filter((def) => def.type === 'ACTION' && def.capability && !ALLOWED_EFFECTS.has(def.capability.key) && isEffectCapability(catalogue.get(def.capability.key)));
    if (forbidden.length > 0) throw new Error(`Nicht erlaubte Wirkungen im Plan: ${forbidden.map((d) => d.capability!.key).join(', ')} – es wird nichts freigegeben.`);
    const recipients = plan.nodes
      .map((n) => n.definition as unknown as PlanNode)
      .filter((def) => def.capability?.key === 'communication.draft')
      .map((def) => JSON.stringify(def.inputs?.to ?? null));
    if (recipients.some((r) => r !== JSON.stringify({ fact: 'contact.email' }))) throw new Error(`Empfänger nicht ausschließlich die Antwortadresse des Vorgangs: ${recipients.join(', ')} – es wird nichts freigegeben.`);
    if (!execute) return void console.log('\nNur angezeigt. Zum Freigeben --execute angeben.');

    const admin = await prisma.withRlsBypass((tx) => tx.user.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
    if (!admin) throw new Error('Kein Benutzer im Betrieb gefunden.');
    await app.get(OrchestratorService).approvePlan(tenant.id, admin.id, plan.id);
    await app.get(OrchestratorService).advance(tenant.id, caseId);
    console.log('\nPlan freigegeben (Auftraggeber-Erlaubnis für diesen Testvorgang); die Einzelaktionsregeln gelten weiter.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
