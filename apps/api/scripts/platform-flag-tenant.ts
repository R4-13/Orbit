/**
 * Setzt oder entfernt den Mandanten-Override eines Plattform-Feature-Flags (Betreiberentscheidung) – mit Eintrag im Plattform-Audit (Akteur „System“, Begründung und Auftraggeber im Vermerk).
 * ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` zeigt das Skript nur den heutigen und den neuen Stand.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/platform-flag-tenant.ts <flag> <tenant-slug> <on|off|remove> --reason "…" [--execute]
 *
 * Wirkt höchstens 5 Sekunden zeitversetzt in laufenden Prozessen (Zwischenspeicher der Plattformsteuerung).
 */
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@orbit/domain';
import { AppModule } from '../src/app.module';
import { PlatformAuditService } from '../src/platform/audit/platform-audit.service';
import { PlatformControlService } from '../src/platform-control/platform-control.service';
import { PrismaService } from '../src/prisma/prisma.service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [flagKey, slug, action] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const reason = option('--reason');
  const execute = process.argv.includes('--execute');
  if (!flagKey || !slug || !['on', 'off', 'remove'].includes(action ?? '') || !reason) throw new Error('Aufruf: platform-flag-tenant.ts <flag> <tenant-slug> <on|off|remove> --reason "…" [--execute]');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const flag = await prisma.withPlatformScope((tx) => tx.platformFeatureFlag.findUnique({ where: { key: flagKey } }));
    if (!flag) throw new Error(`Flag "${flagKey}" nicht gefunden.`);
    if (flag.lifecycle !== 'ACTIVE') console.log(`Achtung: das Flag ist ${flag.lifecycle}, nicht ACTIVE – ein Override wirkt erst im Lebenszyklus ACTIVE.`);

    const before = (flag.tenantOverrides as Array<{ tenantId: string; value: boolean }>) ?? [];
    const current = before.find((o) => o.tenantId === tenant.id);
    const after = before.filter((o) => o.tenantId !== tenant.id);
    if (action !== 'remove') after.push({ tenantId: tenant.id, value: action === 'on' });
    console.log(`${flagKey} für ${tenant.name}: heute ${current ? (current.value ? 'AN (Override)' : 'AUS (Override)') : `Standard (${JSON.stringify(flag.defaultValue)})`} → neu ${action === 'remove' ? 'Standard' : action === 'on' ? 'AN (Override)' : 'AUS (Override)'}.`);
    if (!execute) return void console.log('Nur angezeigt. Zum Ändern --execute angeben.');

    await prisma.withPlatformScope(async (tx) => {
      await tx.platformFeatureFlag.update({ where: { key: flagKey }, data: { tenantOverrides: after as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await app.get(PlatformAuditService).record(
        {
          eventType: 'PLATFORM_FEATURE_FLAG_CHANGED',
          targetType: 'PlatformFeatureFlag',
          targetId: flagKey,
          targetTenantId: tenant.id,
          reason,
          before: { tenantOverride: current ?? null },
          after: { tenantOverride: after.find((o) => o.tenantId === tenant.id) ?? null },
          extra: { via: 'scripts/platform-flag-tenant.ts', auftraggeber: 'Betreiber (Anweisung im Chat)' },
        },
        tx,
      );
    });
    app.get(PlatformControlService).invalidate();
    console.log('Geändert und im Plattform-Audit vermerkt.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
