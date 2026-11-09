/**
 * Kostenbudget eines Betriebs für die KI-Nutzung (Pilotvorbereitung): zeigt die tatsächliche KI-Konfiguration (Anbieter, Modell, Abrechnungsweg, Preis mit Quelle und Prüfdatum – nie Zugangsdaten), den Stand
 * des Monats (gemessen, laufend reserviert, nie abgerechnet, ohne Preis) und setzt oder entfernt ein DURCHGESETZTES Limit. ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` ändert das Skript nichts.
 * Jede Änderung steht mit Begründung und Vorher/Nachher im Plattform-Audit (Akteur „System“, Vermerk des Auftraggebers).
 *
 *   set -a && source .env && source .env.llm.local && set +a   (zeigt so die tatsächliche KI-Konfiguration der Container; dazu IPv4: DATABASE_URL/DATABASE_URL_APP mit 127.0.0.1 statt localhost, falls Docker Desktop nur IPv4 beantwortet)
 *   pnpm --filter @orbit/api exec ts-node scripts/cost-budget.ts anzeigen <tenant-slug>
 *   pnpm --filter @orbit/api exec ts-node scripts/cost-budget.ts setzen <tenant-slug> --hart 10 [--weich 7] [--warn 5] [--waehrung USD] [--durchsetzen] --begruendung "…" [--execute]
 *   pnpm --filter @orbit/api exec ts-node scripts/cost-budget.ts entfernen <tenant-slug> --begruendung "…" [--execute]
 *
 * Ein durchgesetztes Limit weist neue KI-Aufrufe ab, sobald Verbrauch + laufende Aufrufe + schlimmster Fall des neuen Aufrufs das harte Limit überschreiten würden (Mandant; Monat, UTC).
 */
import { NestFactory } from '@nestjs/core';
import { MODEL_PRICE_CATALOG, costLimitScopeKey, costProfileOf, validateCostLimit, type CostLimitDefinition } from '@orbit/shared';
import { AppModule } from '../src/app.module';
import { AiCostGuardrailService } from '../src/ai-governance/ai-cost-guardrail.service';
import { PlatformAuditService } from '../src/platform/audit/platform-audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const number = (name: string): number | undefined => {
  const value = option(name);
  return value === undefined ? undefined : Number(value.replace(',', '.'));
};
const say = (text = ''): void => void process.stdout.write(`${text}\n`);
/** Zeilen mit Dezimalwerten werden für das Audit zu einfachem JSON (Decimal → Zeichenkette). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

async function main(): Promise<void> {
  const [command, slug] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(all[i - 1] ?? '').startsWith('--'));
  if (!['anzeigen', 'setzen', 'entfernen'].includes(command ?? '') || !slug) throw new Error('Aufruf: cost-budget.ts anzeigen|setzen|entfernen <tenant-slug> [Optionen] [--execute]');
  const execute = process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const guard = app.get(AiCostGuardrailService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);

    // ── Tatsächliche Konfiguration (ohne Zugangsdaten) ─────────────────────────────────────────────────────────
    const provider = process.env.LLM_PROVIDER ?? 'mock';
    const model = provider === 'openai' ? process.env.OPENAI_MODEL : provider === 'anthropic' ? process.env.ANTHROPIC_MODEL : undefined;
    const usage = await prisma.withPlatformScope((tx) => tx.aIUsageRecord.groupBy({ by: ['source', 'providerKey', 'modelId'], where: { tenantId: tenant.id }, _count: true, _sum: { estimatedCost: true } }));
    say(`Betrieb: ${tenant.name} (${slug})`);
    say(`KI-Konfiguration dieses Prozesses: Anbieter ${provider}${model ? `, Modell ${model}` : ''}${process.env.OPENAI_REASONING_EFFORT ? `, Denkaufwand ${process.env.OPENAI_REASONING_EFFORT}` : ''}; Weg ENV_BOOTSTRAP (Umgebungsstandard, direkt beim Anbieter, Abrechnung über das Konto des hinterlegten Schlüssels).`);
    const price = costProfileOf(provider, model, { inputPerMtok: Number(process.env.LLM_COST_INPUT_PER_MTOK) || null, outputPerMtok: Number(process.env.LLM_COST_OUTPUT_PER_MTOK) || null, currency: process.env.LLM_COST_CURRENCY ?? null });
    const entry = MODEL_PRICE_CATALOG.find((e) => e.providerKey === provider && e.modelId === model);
    say(price ? `Preis je 1 Mio. Token: ${price.inputPerMtok} Eingabe / ${price.outputPerMtok} Ausgabe ${price.currency}${price.longContext ? ` (ab ${price.longContext.aboveInputTokens} Eingabe-Token ${price.longContext.inputPerMtok}/${price.longContext.outputPerMtok})` : ''} – ${process.env.LLM_COST_INPUT_PER_MTOK ? 'Überschreibung aus der Umgebung' : entry ? `Preiskatalog, Quelle ${entry.source.url}, gelesen am ${entry.source.checkedOn}` : '–'}` : 'Preis: UNBEKANNT – ein durchgesetztes Limit weist dann alle Aufrufe ab (COST_PRICE_UNKNOWN).');
    say(`Bisherige Nutzung dieses Betriebs: ${usage.map((u) => `${u.source}/${u.providerKey}/${u.modelId ?? '-'}: ${u._count} Aufrufe, gemessene Kosten ${u._sum.estimatedCost ?? 'keine (Aufrufe vor der Kostenmessung)'}`).join(' · ') || 'keine'}`);

    const limits = (await guard.list()).filter((l) => l.targetTenantId === tenant.id || l.scope === 'GLOBAL');
    if (limits.length === 0) say('Limits: keine – es gilt kein Kostenlimit, KI-Aufrufe sind nicht begrenzt.');
    for (const l of limits) say(`Limit ${l.scope}: warn ${l.warnAmount ?? '-'} / weich ${l.softAmount ?? '-'} / hart ${l.hardAmount ?? '-'} ${l.currency}, ${l.hardEnforced ? 'DURCHGESETZT' : 'nur gemeldet'} · Monat ab ${l.periodStart.slice(0, 10)}: verbraucht ${l.spent}, laufend reserviert ${l.reserved}, nie abgerechnet ${l.unsettled}, Aufrufe ohne Preis ${l.unmeasuredRequests} · Zustand ${l.state} (Version ${l.version})`);
    if (command === 'anzeigen') return;

    const reason = option('--begruendung');
    if (!reason || reason.trim().length < 10) throw new Error('--begruendung "…" (mindestens 10 Zeichen) ist Pflicht.');
    const scopeKey = `TENANT:${tenant.id}`;
    const existing = await prisma.withPlatformScope((tx) => tx.aICostLimit.findUnique({ where: { scopeKey } }));

    if (command === 'entfernen') {
      say(existing ? `Würde das Limit des Betriebs entfernen (Version ${existing.version}).` : 'Es gibt kein Limit dieses Betriebs.');
      if (!existing || !execute) return void (execute ? undefined : say('Nur angezeigt. Zum Ändern --execute angeben.'));
      await prisma.withPlatformScope(async (tx) => {
        await tx.aICostLimit.delete({ where: { scopeKey } });
        await app.get(PlatformAuditService).record({ eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', targetType: 'AICostLimit', targetId: existing.id, targetTenantId: tenant.id, reason, before: plain(existing), after: null, extra: { via: 'scripts/cost-budget.ts', auftraggeber: 'Betreiber (Anweisung im Chat)' } }, tx);
      });
      return void say('Entfernt und im Plattform-Audit vermerkt.');
    }

    const definition: CostLimitDefinition = { scope: 'TENANT', targetTenantId: tenant.id, profileKey: null, warnAmount: number('--warn') ?? null, softAmount: number('--weich') ?? null, hardAmount: number('--hart') ?? null, hardEnforced: process.argv.includes('--durchsetzen') };
    const currency = (option('--waehrung') ?? 'USD').toUpperCase();
    const issues = validateCostLimit(definition);
    if (issues.length > 0) throw new Error(`Das Limit ist nicht zulässig: ${issues.join(' ')}`);
    if (price && price.currency !== currency && definition.hardEnforced) say(`ACHTUNG: Währung des Limits ${currency} weicht vom Preis (${price.currency}) ab – alle Aufrufe würden abgewiesen (COST_CURRENCY_MISMATCH).`);
    say(`Würde setzen: warn ${definition.warnAmount ?? '-'} / weich ${definition.softAmount ?? '-'} / hart ${definition.hardAmount ?? '-'} ${currency}, ${definition.hardEnforced ? 'DURCHGESETZT (neue KI-Aufrufe werden abgewiesen, wenn das Budget ausgeschöpft wäre)' : 'nur gemeldet'}.`);
    if (!execute) return void say('Nur angezeigt. Zum Ändern --execute angeben.');
    await prisma.withPlatformScope(async (tx) => {
      const data = { warnAmount: definition.warnAmount, softAmount: definition.softAmount, hardAmount: definition.hardAmount, hardEnforced: definition.hardEnforced, currency, note: reason, updatedByUserId: 'script:cost-budget' };
      const row = existing
        ? await tx.aICostLimit.update({ where: { scopeKey }, data: { ...data, version: { increment: 1 } } })
        : await tx.aICostLimit.create({ data: { scope: 'TENANT', scopeKey: costLimitScopeKey(definition), targetTenantId: tenant.id, createdByUserId: 'script:cost-budget', ...data } });
      await app.get(PlatformAuditService).record({ eventType: 'PLATFORM_AI_COST_LIMIT_CHANGED', targetType: 'AICostLimit', targetId: row.id, targetTenantId: tenant.id, reason, before: plain(existing ?? null), after: plain(row), extra: { via: 'scripts/cost-budget.ts', auftraggeber: 'Betreiber (Anweisung im Chat)' } }, tx);
    });
    say('Gesetzt und im Plattform-Audit vermerkt. Wirkt sofort für neue KI-Aufrufe aller Prozesse (keine Zwischenspeicherung).');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
