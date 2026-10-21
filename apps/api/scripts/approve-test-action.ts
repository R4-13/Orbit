/**
 * Gibt die wartende Einzelaktion „E-Mail senden“ EINES ausdrücklich benannten Testvorgangs frei – für den Messlauf, den der Auftraggeber für Tom/Musterwerk erlaubt hat (begrenzte Testfreigaben).
 * ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` zeigt das Skript nur den Entwurf. Es gibt nur frei, wenn
 *   - der Vorgang ausdrücklich per ID benannt ist und die Aktion `email.send` auf Freigabe wartet,
 *   - der Empfänger des Entwurfs genau die Adresse `--only-to` ist, die zugleich die Absenderadresse des Vorgangs ist,
 *   - der Text keinen Preis, keine Zusage („garantieren“, „verbindlich“) und keinen Link enthält.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/approve-test-action.ts <tenant-slug> <case-id> --only-to tomorbit777@gmail.com [--execute]
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestratorService } from '../src/process/orchestrator.service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [slug, caseId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const onlyTo = option('--only-to')?.toLowerCase();
  const execute = process.argv.includes('--execute');
  if (!slug || !caseId || !onlyTo || !/^[0-9a-f-]{36}$/i.test(caseId)) throw new Error('Aufruf: approve-test-action.ts <tenant-slug> <volle-vorgangs-id> --only-to <Adresse> [--execute]');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const scoped = prisma.forTenantId(tenant.id);
    const own = await scoped.case.findFirst({ where: { id: caseId }, select: { parentCaseId: true } });
    const sender = await scoped.emailMessage.findFirst({ where: { caseId: { in: own?.parentCaseId ? [caseId, own.parentCaseId] : [caseId] }, direction: 'INBOUND' }, orderBy: { createdAt: 'asc' }, select: { fromAddress: true } });
    if (!sender || sender.fromAddress.toLowerCase() !== onlyTo) throw new Error(`Die Absenderadresse des Vorgangs (${sender?.fromAddress ?? 'unbekannt'}) ist nicht ${onlyTo}.`);

    const intents = await scoped.actionIntent.findMany({ where: { caseId, status: 'AWAITING_APPROVAL' }, orderBy: { createdAt: 'asc' } });
    if (intents.length === 0) throw new Error('Keine Aktion wartet auf Freigabe.');
    for (const intent of intents) {
      if (intent.capabilityKey !== 'email.send') throw new Error(`Wartende Aktion ${intent.capabilityKey} ist keine E-Mail – es wird nichts freigegeben.`);
      const draftId = (intent.payload as { input?: { draftId?: string } } | null)?.input?.draftId;
      const draft = draftId ? await scoped.communicationDraft.findFirst({ where: { id: draftId } }) : null;
      if (!draft) throw new Error('Entwurf nicht gefunden – es wird nichts freigegeben.');
      console.log(`Aktion ${intent.id.slice(0, 8)}: an ${draft.toAddress} · ${draft.subject}\n${draft.bodyText}\n`);
      if (draft.toAddress.toLowerCase() !== onlyTo) throw new Error(`Empfänger ${draft.toAddress} ist nicht ${onlyTo} – es wird nichts freigegeben.`);
      if (/€|\bEUR\b|\bEuro\b|garantier|verbindlich|https?:\/\//i.test(draft.bodyText)) throw new Error('Der Text enthält einen Preis, eine Zusage oder einen Link – es wird nichts freigegeben.');
    }
    if (!execute) return void console.log('Nur angezeigt. Zum Freigeben --execute angeben.');

    const admin = await prisma.withRlsBypass((tx) => tx.user.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
    if (!admin) throw new Error('Kein Benutzer im Betrieb gefunden.');
    for (const intent of intents) {
      const result = await app.get(OrchestratorService).decideAction(tenant.id, admin.id, intent.id, 'APPROVED');
      console.log(`Aktion ${intent.id.slice(0, 8)}: ${result.applied ? 'freigegeben' : `nicht angewendet (${result.reason ?? '?'})`}`);
    }
    await app.get(OrchestratorService).advance(tenant.id, caseId);
    console.log('Vorgang weitergeführt (Testfreigabe des Auftraggebers für diesen Vorgang).');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
