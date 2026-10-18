/**
 * Räumt Testeinträge automatischer Tests aus einem Betrieb auf (z. B. dem Demo-Betrieb „Musterwerk“). ERST ZÄHLEN, DANN LÖSCHEN: ohne `--execute` zeigt das Skript nur, was es
 * entfernen würde (Anzahl und Beispiele je Art) und was bleibt; es ändert nichts.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/cleanup-e2e-leftovers.ts <tenant-slug>              # nur anzeigen
 *   pnpm --filter @orbit/api exec ts-node scripts/cleanup-e2e-leftovers.ts <tenant-slug> --execute    # wirklich löschen (vorher sichern: scripts/backup-postgres.sh backup)
 *   pnpm --filter @orbit/api exec ts-node scripts/cleanup-e2e-leftovers.ts --tenants [--execute]      # liegengebliebene Test-Betriebe „e2e-…“ (älter als ein Tag)
 *
 * Als Testeintrag gilt NUR, was eine Marke „E2E“ trägt (Name, Nummer, Titel, Schlüssel) oder an einem solchen Vorgang hängt; Kontakte und Mails werden an ihrer Adresse erkannt
 * (Domäne mit „e2e“). Echte Einträge, auch die Live-Tests mit der Testadresse des Kunden, bleiben. Das Protokoll (Audit) wird nie verändert.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 24 * 3_600_000;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const tenantsMode = args.includes('--tenants');
  const slug = args.find((a) => !a.startsWith('--'));
  if (!tenantsMode && !slug) throw new Error('Aufruf: cleanup-e2e-leftovers.ts <tenant-slug> [--execute]  |  --tenants [--execute]');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);

    if (tenantsMode) {
      const stale = await prisma.withRlsBypass((tx) => tx.tenant.findMany({ where: { slug: { startsWith: 'e2e-' }, createdAt: { lt: new Date(Date.now() - DAY_MS) } }, select: { id: true, slug: true, createdAt: true }, orderBy: { createdAt: 'asc' } }));
      console.log(`${stale.length} liegengebliebene Test-Betriebe (Kennung „e2e-…“, älter als ein Tag):`);
      for (const t of stale) console.log(`  ${t.slug}  (${t.createdAt.toISOString().slice(0, 10)})`);
      if (!execute) return void console.log('\nNur angezeigt. Zum Löschen --execute angeben.');
      const result = await prisma.withRlsBypass((tx) => tx.tenant.deleteMany({ where: { id: { in: stale.map((t) => t.id) }, slug: { startsWith: 'e2e-' } } }));
      return void console.log(`\n${result.count} Test-Betriebe gelöscht.`);
    }

    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug: slug as string }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const tenantId = tenant.id;

    await prisma.withRlsBypass(async (tx) => {
      const e2e = { contains: 'e2e', mode: 'insensitive' as const };
      const cases = await tx.case.findMany({ where: { tenantId, title: e2e }, select: { id: true } });
      // Auch Vorgänge ohne Marke im Titel, die an einer Test-Mail hängen (Adresse mit „e2e“), sind Testeinträge.
      const mailCases = await tx.emailMessage.findMany({ where: { tenantId, caseId: { not: null }, OR: [{ subject: e2e }, { fromAddress: e2e }] }, select: { caseId: true }, distinct: ['caseId'] });
      const caseIds = [...new Set([...cases.map((c) => c.id), ...mailCases.map((m) => m.caseId as string)])];
      const suppliers = await tx.supplier.findMany({ where: { tenantId, name: { startsWith: 'E2E', mode: 'insensitive' } }, select: { id: true } });
      const invoices = await tx.invoice.findMany({ where: { tenantId, OR: [{ invoiceNumber: { startsWith: 'E2E-' } }, { caseId: { in: caseIds } }, { supplierId: { in: suppliers.map((s) => s.id) } }] }, select: { id: true } });
      const supplierIds = suppliers.map((s) => s.id);
      const invoiceIds = invoices.map((i) => i.id);
      const intents = await tx.actionIntent.findMany({ where: { tenantId, caseId: { in: caseIds } }, select: { id: true } });

      const where = {
        approvals: { tenantId, OR: [{ reason: e2e }, { entityType: 'SUPPLIER' as const, entityId: { in: supplierIds } }, { entityType: 'INVOICE' as const, entityId: { in: invoiceIds } }, { entityType: 'PROCESS_ACTION' as const, entityId: { in: intents.map((i) => i.id) } }] },
        tasks: { tenantId, OR: [{ title: e2e }, { caseId: { in: caseIds } }] },
        documents: { tenantId, OR: [{ fileName: { startsWith: 'e2e', mode: 'insensitive' as const } }, { caseId: { in: caseIds } }] },
        emails: { tenantId, OR: [{ caseId: { in: caseIds } }, { subject: e2e }, { fromAddress: e2e }] },
        intakeEvents: { tenantId, caseId: { in: caseIds } },
        contacts: { tenantId, OR: [{ firstName: { startsWith: 'E2E', mode: 'insensitive' as const } }, { lastName: { startsWith: 'E2E', mode: 'insensitive' as const } }, { email: e2e }] },
        companies: { tenantId, name: { startsWith: 'E2E', mode: 'insensitive' as const } },
        agents: { tenantId, key: { startsWith: 'e2e', mode: 'insensitive' as const } },
        workflows: { tenantId, key: { startsWith: 'e2e', mode: 'insensitive' as const } },
      };

      const rows: Array<{ label: string; count: number; sample: string[] }> = [];
      const add = async (label: string, count: Promise<number>, sample: Promise<string[]>) => rows.push({ label, count: await count, sample: await sample });
      await add('Freigaben', tx.approval.count({ where: where.approvals }), tx.approval.findMany({ where: { ...where.approvals, status: 'PENDING' }, select: { reason: true }, take: 2 }).then((r) => r.map((x) => x.reason ?? '')));
      await add('Vorgänge', Promise.resolve(caseIds.length), tx.case.findMany({ where: { id: { in: caseIds } }, select: { title: true }, take: 2 }).then((r) => r.map((x) => x.title)));
      await add('Rechnungen', Promise.resolve(invoiceIds.length), tx.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { invoiceNumber: true }, take: 2 }).then((r) => r.map((x) => x.invoiceNumber ?? '')));
      await add('Lieferanten', Promise.resolve(supplierIds.length), tx.supplier.findMany({ where: { id: { in: supplierIds } }, select: { name: true }, take: 2 }).then((r) => r.map((x) => x.name)));
      await add('Aufgaben', tx.task.count({ where: where.tasks }), tx.task.findMany({ where: where.tasks, select: { title: true }, take: 2 }).then((r) => r.map((x) => x.title)));
      await add('Dokumente', tx.document.count({ where: where.documents }), tx.document.findMany({ where: where.documents, select: { fileName: true }, take: 2 }).then((r) => r.map((x) => x.fileName)));
      await add('E-Mails', tx.emailMessage.count({ where: where.emails }), tx.emailMessage.findMany({ where: where.emails, select: { subject: true }, take: 2 }).then((r) => r.map((x) => x.subject ?? '')));
      await add('Eingänge (Intake)', tx.intakeEvent.count({ where: where.intakeEvents }), Promise.resolve([]));
      await add('Kontakte', tx.contact.count({ where: where.contacts }), tx.contact.findMany({ where: where.contacts, select: { email: true }, take: 2 }).then((r) => r.map((x) => x.email ?? '')));
      await add('Unternehmen', tx.company.count({ where: where.companies }), tx.company.findMany({ where: where.companies, select: { name: true }, take: 2 }).then((r) => r.map((x) => x.name)));
      await add('Agenten-Definitionen', tx.agentDefinition.count({ where: where.agents }), Promise.resolve([]));
      await add('Ablauf-Definitionen', tx.workflowDefinition.count({ where: where.workflows }), Promise.resolve([]));

      console.log(`Betrieb: ${tenant.name} (${slug})\n\nWürde entfernt (Testeinträge mit Marke „E2E“):`);
      for (const r of rows) console.log(`  ${r.label.padEnd(22)} ${String(r.count).padStart(5)}${r.sample.length > 0 ? `   z. B. ${r.sample.map((s) => `„${s.slice(0, 60)}“`).join(', ')}` : ''}`);
      const kept = {
        Freigaben: (await tx.approval.count({ where: { tenantId } })) - rows[0]!.count,
        Vorgänge: (await tx.case.count({ where: { tenantId } })) - caseIds.length,
        Rechnungen: (await tx.invoice.count({ where: { tenantId } })) - invoiceIds.length,
        Lieferanten: (await tx.supplier.count({ where: { tenantId } })) - supplierIds.length,
        Kontakte: (await tx.contact.count({ where: { tenantId } })) - rows[8]!.count,
      };
      console.log(`\nBleibt: ${Object.entries(kept).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
      if (!execute) return void console.log('\nNur angezeigt, nichts geändert. Zum Löschen --execute angeben (vorher sichern).');

      // Reihenfolge: erst, was an anderem hängt; Vorgänge zuletzt (Untereinträge hängen per Kaskade bzw. „entkoppelt“ daran).
      await tx.approval.deleteMany({ where: where.approvals });
      await tx.task.deleteMany({ where: where.tasks });
      await tx.emailMessage.deleteMany({ where: where.emails });
      await tx.intakeEvent.deleteMany({ where: where.intakeEvents });
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await tx.document.deleteMany({ where: where.documents });
      await tx.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await tx.case.deleteMany({ where: { id: { in: caseIds } } });
      await tx.contact.deleteMany({ where: where.contacts });
      await tx.company.deleteMany({ where: where.companies });
      await tx.workflowDefinition.deleteMany({ where: where.workflows });
      await tx.agentDefinition.deleteMany({ where: where.agents });
      console.log('\nGelöscht.');
    });
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
