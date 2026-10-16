/**
 * Bewertet gespeicherte Läufe des Live-Tests `autonomy-agent.live` (BPF-05, Agent-Ebene): je Szenario, ob erreicht wurde, was sein soll (`src/evaluation/agent-evaluation.ts`).
 *
 *   LIVE_AI=1 ASSESSMENT_OUT=lauf1.json node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/jest-e2e.json --runInBand test/autonomy-agent.live
 *   pnpm --filter @orbit/api exec ts-node scripts/score-agent-runs.ts lauf1.json lauf2.json lauf3.json [--min-pass 0.9] [--out bericht.json]
 *
 * Exitcode 2, wenn der Anteil bestandener Szenario-Läufe unter `--min-pass` liegt (Standard 0,8).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { summariseAgentRuns, type AgentRecord } from '../src/evaluation/agent-evaluation';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const flagValues = new Set(['--min-pass', '--out'].flatMap((flag) => [process.argv[process.argv.indexOf(flag) + 1]]));
const files = process.argv.slice(2).filter((a) => !a.startsWith('--') && !flagValues.has(a));
if (files.length === 0) {
  console.error('Aufruf: score-agent-runs.ts <lauf.json> [weitere …] [--min-pass 0.8] [--out bericht.json]');
  process.exit(1);
}
const minPass = Number(arg('min-pass') ?? '0.8');
const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as AgentRecord[]);
const summary = summariseAgentRuns(runs);
const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)} %`);

for (const s of summary.scenarios) {
  console.log(`${s.passed === s.runs ? 'PASS ' : s.passed === 0 ? 'FAIL ' : 'FLAKY'} ${s.id.padEnd(4)} ${s.passed}/${s.runs}  ${s.intent}`);
  for (const f of s.failing) console.log(`        ✘ ${f.name} (${f.runs} von ${s.runs} Läufen)`);
}
console.log(`\n${summary.runs} Läufe · bestandene Szenario-Läufe ${pct(summary.passRate)} · immer bestanden ${pct(summary.alwaysPassing)} · gleicher Weg in allen Läufen ${pct(summary.stableScenarios)}`);
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), files, summary }, null, 2), 'utf8');
if (summary.passRate !== null && summary.passRate < minPass) {
  console.log(`Gütekriterium verfehlt: ${pct(summary.passRate)} < ${pct(minPass)}`);
  process.exitCode = 2;
}
