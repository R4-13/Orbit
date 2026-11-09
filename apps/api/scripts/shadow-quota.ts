/**
 * Zusätzliches Kontingent an Schattenplanungen (Prüfplan D9): Stand anzeigen, Entscheidung festhalten, aktivieren, beenden. ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` ändert das Skript nichts.
 * Jede Änderung steht im Mandanten-Audit (SHADOW_QUOTA_GRANT_*) und im Hauptbuch; der bisherige Grundzähler (Obergrenze 60) wird nie berührt.
 *
 *   set -a && source .env && set +a   (IPv4: DATABASE_URL/DATABASE_URL_APP mit 127.0.0.1, falls nötig)
 *   pnpm --filter @orbit/api exec ts-node scripts/shadow-quota.ts anzeigen    <tenant-slug>
 *   pnpm --filter @orbit/api exec ts-node scripts/shadow-quota.ts anlegen     <tenant-slug> --anzahl 45 --zweck "Prüflauf D9, Gruppen B und C" --beschlossen "Auftraggeber, <Datum>" [--execute]
 *   pnpm --filter @orbit/api exec ts-node scripts/shadow-quota.ts aktivieren  <tenant-slug> <Kontingent-ID> --durch "Auftraggeber, <Datum>" [--execute]
 *   pnpm --filter @orbit/api exec ts-node scripts/shadow-quota.ts beenden     <tenant-slug> <Kontingent-ID> --grund "…" [--execute]
 *
 * Ein Kontingent wirkt nur im Zustand ACTIVE, nur wenn die Grundgrenze erreicht ist und nur, wenn für den Betrieb das Plattform-Flag `planner.shadow` eingeschaltet ist (eigener Schritt: platform-flag-tenant.ts).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ShadowQuotaService } from '../src/process/shadow-quota.service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const say = (text = ''): void => void process.stdout.write(`${text}\n`);

async function main(): Promise<void> {
  const [command, slug, grantId] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
  if (!['anzeigen', 'anlegen', 'aktivieren', 'beenden'].includes(command ?? '') || !slug) throw new Error('Aufruf: shadow-quota.ts anzeigen|anlegen|aktivieren|beenden <tenant-slug> [Kontingent-ID] [Optionen] [--execute]');
  const execute = process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const quota = app.get(ShadowQuotaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const status = await quota.status(tenant.id);
    say(`Betrieb: ${tenant.name} (${slug})`);
    say(`Grundzähler: ${status.base.used} von ${status.base.limit}${status.base.used >= status.base.limit ? ' (Grundgrenze erreicht)' : ''} – bleibt unverändert.`);
    if (status.grants.length === 0) say('Zusatzkontingente: keine (Standard) – an der Grundgrenze wird nicht mehr geplant.');
    for (const g of status.grants) say(`Kontingent ${g.id}: ${g.status}, ${g.amount} Einheiten (verbraucht ${g.consumed}: ${g.done} fertig, ${g.reserved} laufend, ${g.unavailable} nicht möglich, davon Wiederholungen ${g.repeats}; verbleibend ${g.remaining}) · Zweck: ${g.purpose} · beschlossen: ${g.decidedBy}`);
    if (command === 'anzeigen') return;

    if (command === 'anlegen') {
      const amount = Number(option('--anzahl'));
      const purpose = option('--zweck') ?? '';
      const decidedBy = option('--beschlossen') ?? '';
      say(`Würde anlegen: ${amount} Einheiten, Zweck „${purpose}“, beschlossen von „${decidedBy}“ – im Zustand INACTIVE (wirkt erst nach Aktivierung).`);
      if (!execute) return void say('Nur angezeigt. Zum Ändern --execute angeben.');
      const created = await quota.create(tenant.id, { amount, purpose, decidedBy });
      return void say(`Angelegt: ${created.id} (INACTIVE).`);
    }
    if (!grantId) throw new Error('Kontingent-ID angeben.');
    if (command === 'aktivieren') {
      const by = option('--durch') ?? '';
      say(`Würde Kontingent ${grantId} aktivieren (durch „${by}“). Danach kann der Betrieb bei erreichter Grundgrenze daraus planen – wenn das Flag planner.shadow eingeschaltet ist.`);
      if (!execute) return void say('Nur angezeigt. Zum Ändern --execute angeben.');
      return void say(`Aktiviert: ${(await quota.activate(tenant.id, grantId, by)).status}.`);
    }
    const why = option('--grund') ?? '';
    say(`Würde Kontingent ${grantId} beenden (Grund „${why}“). Bereits Verbrauchtes bleibt im Hauptbuch.`);
    if (!execute) return void say('Nur angezeigt. Zum Ändern --execute angeben.');
    say(`Beendet: ${(await quota.revoke(tenant.id, grantId, why)).status}.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
