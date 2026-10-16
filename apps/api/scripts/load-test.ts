/**
 * Lasttest der API-Lesepfade (UNI-01): mehrere Anfragen gleichzeitig gegen den laufenden Stack, gemessen werden Antwortzeiten (p50/p95/p99), Fehlerquote und Durchsatz je Route.
 * Er verändert nichts (nur lesende Routen) und braucht ein bestehendes Konto. Der Test misst **diese** Umgebung mit **diesem** Datenbestand – er ersetzt keinen Skalierungsnachweis
 * unter Produktionslast, zeigt aber Ausreißer und Rückschritte (`--baseline`).
 *
 *   LOAD_EMAIL=admin@musterwerk.example LOAD_PASSWORD=... pnpm --filter @orbit/api exec ts-node scripts/load-test.ts [--base http://localhost:3001] [--concurrency 10] [--seconds 15] [--out bericht.json] [--baseline frueher.json] [--no-fail]
 *
 * Latenzbudgets je Route stehen in `BUDGETS_MS` (p95). Exitcode 2 bei überschrittenem Budget, Fehlerquote über 1 % oder (mit `--baseline`) einer Verschlechterung des p95 um mehr als 50 %.
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Route {
  name: string;
  path: string;
  /** Budget für den 95. Perzentil der Antwortzeit in Millisekunden bei der gewählten Parallelität. */
  budgetMs: number;
}

const ROUTES: Route[] = [
  { name: 'Kontoabfrage', path: '/api/v1/auth/me', budgetMs: 150 },
  { name: 'Vorgänge', path: '/api/v1/cases', budgetMs: 400 },
  { name: 'Aufgaben', path: '/api/v1/tasks', budgetMs: 400 },
  { name: 'Rechnungen', path: '/api/v1/invoices', budgetMs: 500 },
  { name: 'Freigaben', path: '/api/v1/approvals', budgetMs: 500 },
  { name: 'Lieferanten', path: '/api/v1/suppliers', budgetMs: 400 },
  { name: 'Kontakte', path: '/api/v1/contacts', budgetMs: 400 },
  { name: 'Suche', path: '/api/v1/search?q=muster', budgetMs: 500 },
  { name: 'Startseite (Zusammenfassung)', path: '/api/v1/dashboard/snapshot?view=TEAM&period=WEEK', budgetMs: 1200 },
  { name: 'Bericht Eingriffe', path: '/api/v1/reports/interventions?days=30', budgetMs: 1500 },
  { name: 'Mitarbeiterverzeichnis', path: '/api/v1/staff', budgetMs: 400 },
  { name: 'Betriebsprofil', path: '/api/v1/tenant/profile', budgetMs: 400 },
];

interface RouteResult {
  name: string;
  path: string;
  budgetMs: number;
  requests: number;
  errors: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  perSecond: number;
  withinBudget: boolean;
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] as number;
}

async function login(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`Anmeldung fehlgeschlagen (${response.status}).`);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function measure(base: string, token: string, route: Route, concurrency: number, seconds: number): Promise<RouteResult> {
  const latencies: number[] = [];
  let errors = 0;
  const stopAt = Date.now() + seconds * 1000;
  const worker = async () => {
    while (Date.now() < stopAt) {
      const started = performance.now();
      try {
        const response = await fetch(`${base}${route.path}`, { headers: { Authorization: `Bearer ${token}` } });
        await response.arrayBuffer();
        if (!response.ok) errors += 1;
        else latencies.push(performance.now() - started);
      } catch {
        errors += 1;
      }
    }
  };
  const began = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (Date.now() - began) / 1000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    name: route.name,
    path: route.path,
    budgetMs: route.budgetMs,
    requests: latencies.length + errors,
    errors,
    p50: round(percentile(sorted, 50)),
    p95: round(p95),
    p99: round(percentile(sorted, 99)),
    perSecond: Math.round(((latencies.length + errors) / elapsed) * 10) / 10,
    withinBudget: p95 !== null && p95 <= route.budgetMs,
  };
}

async function main(): Promise<void> {
  const base = arg('base', 'http://localhost:3001') as string;
  const concurrency = Math.max(1, Number(arg('concurrency', '10')));
  const seconds = Math.max(1, Number(arg('seconds', '15')));
  const email = process.env.LOAD_EMAIL;
  const password = process.env.LOAD_PASSWORD;
  if (!email || !password) throw new Error('LOAD_EMAIL und LOAD_PASSWORD müssen gesetzt sein (ein bestehendes Konto der Umgebung).');
  const token = await login(base, email, password);

  const results: RouteResult[] = [];
  for (const route of ROUTES) {
    const result = await measure(base, token, route, concurrency, seconds);
    results.push(result);
    console.log(`${result.withinBudget && result.errors === 0 ? 'OK  ' : 'LANG'} ${result.name.padEnd(30)} p50 ${String(result.p50 ?? '–').padStart(5)} ms · p95 ${String(result.p95 ?? '–').padStart(5)} ms (Budget ${route.budgetMs}) · p99 ${String(result.p99 ?? '–').padStart(5)} ms · ${result.perSecond}/s · Fehler ${result.errors}/${result.requests}`);
  }

  const totalRequests = results.reduce((n, r) => n + r.requests, 0);
  const totalErrors = results.reduce((n, r) => n + r.errors, 0);
  const errorRate = totalRequests === 0 ? 1 : totalErrors / totalRequests;
  const failures: string[] = [];
  for (const r of results) if (!r.withinBudget) failures.push(`${r.name}: p95 ${r.p95 ?? '–'} ms über dem Budget von ${r.budgetMs} ms`);
  if (errorRate > 0.01) failures.push(`Fehlerquote ${(errorRate * 100).toFixed(1)} % über 1 %`);

  const baselinePath = arg('baseline');
  if (baselinePath) {
    const before = (JSON.parse(readFileSync(baselinePath, 'utf8')) as { results: RouteResult[] }).results;
    for (const r of results) {
      const old = before.find((b) => b.path === r.path);
      if (old?.p95 && r.p95 && r.p95 > old.p95 * 1.5 && r.p95 - old.p95 > 30) failures.push(`${r.name}: p95 ${old.p95} → ${r.p95} ms (mehr als 50 % schlechter)`);
    }
  }

  console.log(`\n${concurrency} gleichzeitige Anfragen × ${seconds} s je Route · ${totalRequests} Anfragen · Fehlerquote ${(errorRate * 100).toFixed(2)} %`);
  console.log(failures.length === 0 ? 'Budgets: eingehalten' : `Budgets VERFEHLT:\n  - ${failures.join('\n  - ')}`);
  const out = arg('out');
  if (out) writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), base, concurrency, seconds, errorRate, failures, results }, null, 2), 'utf8');
  if (failures.length > 0 && !process.argv.includes('--no-fail')) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
