/**
 * Qualitätsmessung der KI-Einstufung mit dem ECHTEN Modell (BPF-05). Läuft über denselben `SemanticTriageService` und dieselben deterministischen Schwellen wie der Eingang,
 * verändert aber nichts (kein Eingangsereignis, kein Vorgang, keine Mail). Für den Lauf wird ein Wegwerf-Betrieb mit Profil angelegt und danach gelöscht.
 *
 *   set -a && source .env && source .env.llm.local && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/run-ai-evaluation.ts [--set dev|v1|tuning|holdout|all] [--repeats 3] [--out report.json] [--baseline frueherer-report.json] [--no-fail]
 *
 * Sätze (siehe docs/evaluation/README.md):
 *   - dev:     `fixtures/evaluation/triage-catalogue.json` – darf zum Verbessern der Anweisung verwendet werden.
 *   - v1:      `fixtures/evaluation/triage-holdout-v1.json` – seit Oktober 2026 verbraucht (zweimal ausgewertet), gilt als Entwicklungsmaterial.
 *   - holdout: `fixtures/evaluation/triage-holdout-v2.json` – versiegelt, nie zum Verbessern verwendet; ein verändertes Siegel wird gemeldet.
 *   - tuning = dev + v1, all = alles.
 *
 * Exitcode 2, wenn ein Gütekriterium (`fixtures/evaluation/thresholds.json`) verfehlt wird oder sich gegenüber `--baseline` etwas verschlechtert (außer mit `--no-fail`).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrbitEnv } from '@orbit/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ORBIT_ENV } from '../src/config/env.token';
import {
  aggregate,
  catalogueProblems,
  checkThresholds,
  regressions,
  scoreCase,
  sealOf,
  type CaseResult,
  type EvaluationCase,
  type Metrics,
  type Observation,
  type Thresholds,
} from '../src/evaluation/triage-evaluation';
import { SemanticTriageService } from '../src/intake/semantic-triage.service';
import { deriveAppliedRelevance } from '../src/intake/triage-decision';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantsService } from '../src/tenants/tenants.service';

const FIXTURES = join(__dirname, '../../../fixtures/evaluation');

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const SEALED = { name: 'holdout-v2', file: 'triage-holdout-v2' };

function readCases(file: string): { cases: EvaluationCase[]; text: string } {
  const text = readFileSync(join(FIXTURES, `${file}.json`), 'utf8');
  return { cases: (JSON.parse(text) as { cases: EvaluationCase[] }).cases, text };
}

function loadCases(set: string): { cases: EvaluationCase[]; sealWarning?: string } {
  const out: EvaluationCase[] = [];
  let sealWarning: string | undefined;
  if (['dev', 'tuning', 'all'].includes(set)) out.push(...readCases('triage-catalogue').cases);
  if (['v1', 'tuning', 'all'].includes(set)) out.push(...readCases('triage-holdout-v1').cases);
  if (set === 'holdout' || set === 'all') {
    const { cases, text } = readCases(SEALED.file);
    const sealed = readFileSync(join(FIXTURES, `${SEALED.file}.sha256`), 'utf8').trim();
    if (sealOf(text) !== sealed) sealWarning = `ACHTUNG: Der versiegelte Prüfsatz (${SEALED.name}) wurde nach dem ersten Lauf verändert – die Ergebnisse sind kein unabhängiger Nachweis mehr. Neuen Satz anlegen.`;
    out.push(...cases);
  }
  const problems = catalogueProblems(out);
  if (problems.length > 0) throw new Error(`Katalog fehlerhaft: ${problems.join('; ')}`);
  return { cases: out, sealWarning };
}

async function main(): Promise<void> {
  const set = arg('set', 'all') as string;
  if (!['dev', 'v1', 'tuning', 'holdout', 'all'].includes(set)) throw new Error('--set muss dev, v1, tuning, holdout oder all sein.');
  const repeats = Math.max(1, Number(arg('repeats', '1')));
  const { cases, sealWarning } = loadCases(set);
  const thresholds = JSON.parse(readFileSync(join(FIXTURES, 'thresholds.json'), 'utf8')) as Thresholds;
  const baselinePath = arg('baseline');
  const baseline = baselinePath ? ((JSON.parse(readFileSync(baselinePath, 'utf8')) as { metrics: Metrics }).metrics) : undefined;
  if (sealWarning) console.warn(sealWarning);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  let tenantId: string | undefined;
  try {
    const suffix = randomUUID();
    const { tenant } = await app.get(TenantsService).bootstrapTenant({ name: `Bewertung ${suffix.slice(0, 6)}`, slug: `e2e-eval-${suffix}`, adminEmail: `eval-${suffix}@e2e-eval.example`, adminPassword: `Eval-${suffix}-9!`, adminFirstName: 'Eval', adminLastName: 'Lauf', industry: 'Heizung und Sanitär' });
    tenantId = tenant.id;
    await prisma.forTenantId(tenantId).tenantProfile.update({
      where: { tenantId },
      data: {
        description: 'Meisterbetrieb für Heizung und Sanitär in Köln.',
        services: ['Heizungswartung', 'Badsanierung', 'Rohrreinigung', 'Heizkörpertausch', 'Wärmepumpen'],
        exclusions: ['Elektroarbeiten'],
        serviceArea: 'Köln und Umgebung (30 km)',
        openingHours: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '07:00', to: '16:00' }],
        emergencyService: true,
        emergencyNote: 'Notdienst rund um die Uhr',
        languages: ['de', 'en'],
      },
    });
    const env = app.get<OrbitEnv>(ORBIT_ENV);
    const triage = app.get(SemanticTriageService);
    const results: CaseResult[] = [];
    let model = '?';
    let promptVersion = '?';

    for (const c of cases) {
      const runs: CaseResult['runs'] = [];
      for (let attempt = 1; attempt <= repeats; attempt += 1) {
        try {
          const outcome = await triage.triage(tenantId, undefined, {
            tenantId,
            channel: 'SIMULATED',
            provider: 'evaluation',
            externalEventId: `eval-${c.id}-${attempt}-${randomUUID().slice(0, 8)}`,
            occurredAt: new Date(),
            sender: { address: c.from },
            recipients: [{ address: 'info@sanitaer.example' }],
            subject: c.subject,
            content: c.body,
            direction: 'INBOUND',
            hints: c.hints,
          });
          if (outcome.status !== 'DECIDED') {
            runs.push({ error: `${outcome.status}: ${'detail' in outcome ? String(outcome.detail).slice(0, 160) : ''}`, pass: false });
            continue;
          }
          model = `${outcome.execution.provider}/${outcome.execution.model}`;
          promptVersion = outcome.execution.promptVersion;
          const applied = deriveAppliedRelevance(outcome.result, { minConfidence: env.TRIAGE_MIN_CONFIDENCE, exclusionMinConfidence: env.TRIAGE_EXCLUSION_MIN_CONFIDENCE });
          const observed: Observation = {
            appliedRelevance: applied.relevance as Observation['appliedRelevance'],
            category: outcome.result.category,
            urgency: outcome.result.urgency,
            relation: outcome.result.conversationRelation,
            riskFlags: outcome.result.riskFlags,
            intentCount: outcome.result.intents.length,
            latencyMs: outcome.execution.latencyMs,
          };
          runs.push({ observed, ...scoreCase(c.expect, observed) });
        } catch (error) {
          runs.push({ error: error instanceof Error ? error.message.slice(0, 160) : String(error), pass: false });
        }
      }
      results.push({ id: c.id, label: c.label, expect: c.expect, runs });
      const last = runs.at(-1);
      console.log(`${runs.every((r) => r.pass) ? 'PASS' : runs.some((r) => r.pass) ? 'FLAKY' : 'FAIL'}  ${c.id.padEnd(5)} ${c.label.slice(0, 46).padEnd(46)} → ${last?.observed ? `${last.observed.category} / ${last.observed.appliedRelevance} / ${last.observed.urgency}` : last?.error ?? '?'}`);
    }

    const metrics = aggregate(results);
    const verdict = checkThresholds(metrics, thresholds);
    const slipped = baseline ? regressions(metrics, baseline) : [];
    const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)} %`);
    console.log(`\nModell ${model} · Anweisung ${promptVersion} · Satz ${set} · ${metrics.cases} Fälle × ${repeats} = ${metrics.runs} Läufe`);
    console.log(`Trefferquote ${pct(metrics.passRate)} · Notfälle erkannt ${pct(metrics.emergencyRecall)} · Fehlalarme ${pct(metrics.falseAlarmRate)} · zu Unrecht ausgeschlossen ${pct(metrics.missedBusinessRate)} · Konsistenz ${pct(metrics.consistency)} (des Wegs ${pct(metrics.routingConsistency)}) · ohne Ergebnis ${metrics.failedRuns}`);
    console.log(`Antwortzeit p50 ${metrics.latencyMs?.p50 ?? '–'} ms · p95 ${metrics.latencyMs?.p95 ?? '–'} ms`);
    for (const [name, a] of Object.entries(metrics.accuracy)) console.log(`  ${name.padEnd(16)} ${a.ok}/${a.checked} (${pct(a.rate)})`);
    console.log(verdict.ok ? 'Gütekriterien: erfüllt' : `Gütekriterien VERFEHLT:\n  - ${verdict.failures.join('\n  - ')}`);
    if (slipped.length > 0) console.log(`Verschlechtert gegenüber ${baselinePath}:\n  - ${slipped.join('\n  - ')}`);

    const out = arg('out');
    if (out) {
      writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), model, promptVersion, set, repeats, sealWarning, metrics, verdict, regressions: slipped, results }, null, 2), 'utf8');
      console.log(`Bericht: ${out}`);
    }
    if ((!verdict.ok || slipped.length > 0) && !process.argv.includes('--no-fail')) process.exitCode = 2;
  } finally {
    if (tenantId) await prisma.withRlsBypass((tx) => tx.tenant.delete({ where: { id: tenantId as string } })).catch(() => undefined);
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
