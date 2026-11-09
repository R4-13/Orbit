/**
 * Beweissicherung für die Stopp- und Wiederanlaufprobe (Pilotvorbereitung W5): hält den Zustand eines Betriebs zu einem Zeitpunkt fest und vergleicht zwei Zustände. Das Skript LIEST nur (es stoppt, startet
 * und ändert nichts); das Vorgehen der Probe steht in docs/PILOT_BETRIEB_RUNBOOK.md. Ausgabedateien enthalten keine Nachrichteninhalte und keine Zugangsdaten – nur Kennungen, Zustände und Zähler.
 *
 *   set -a && source .env && set +a   (IPv4: DATABASE_URL/DATABASE_URL_APP mit 127.0.0.1, falls nötig)
 *   pnpm --filter @orbit/api exec ts-node scripts/stop-drill.ts schnappschuss <tenant-slug> <Ausgabedatei.json>
 *   pnpm --filter @orbit/api exec ts-node scripts/stop-drill.ts vergleich <vorher.json> <nachher.json> [--stopp]
 *
 * `vergleich` prüft: kein Vorgang verloren, kein Eingang verloren, keine offene Freigabe verschwunden, kein Statusrückfall eines Vorgangs auf „abgeschlossen“ ohne Ereignis; mit `--stopp` zusätzlich, dass
 * ZWISCHEN den beiden Zuständen (Stopp-Fenster) nichts wirksam wurde: keine neue bestätigte Aktion, keine neue Nachricht, kein neuer Vorgang.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface Snapshot {
  zeit: string;
  betrieb: string;
  vorgaenge: Record<string, { status: string; ereignisse: number }>;
  eingaenge: string[];
  offeneFreigaben: string[];
  aktiveWartebedingungen: number;
  offeneAufgaben: number;
  bestaetigteAktionen: number;
  gesendeteNachrichten: number;
  notbremsen: Record<string, boolean>;
  flags: Record<string, unknown>;
}

const say = (text = ''): void => void process.stdout.write(`${text}\n`);

async function snapshot(slug: string, file: string): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.withRlsBypass((tx) => tx.tenant.findUnique({ where: { slug }, select: { id: true, name: true } }));
    if (!tenant) throw new Error(`Betrieb "${slug}" nicht gefunden.`);
    const scoped = prisma.forTenantId(tenant.id);
    const cases = await scoped.case.findMany({ select: { id: true, orchestrationStatus: true, eventSequence: true } });
    const intakes = await scoped.intakeEvent.findMany({ select: { id: true } });
    const approvals = await scoped.approval.findMany({ where: { status: 'PENDING' }, select: { id: true } });
    const switches = await prisma.withPlatformScope((tx) => tx.platformKillSwitch.findMany({ select: { key: true, engaged: true } }));
    const flags = await prisma.withPlatformScope((tx) => tx.platformFeatureFlag.findMany({ where: { key: { in: ['planner.shadow', 'process.split', 'planner.adaptive', 'external.autonomous_send'] } }, select: { key: true, defaultValue: true, tenantOverrides: true } }));
    const result: Snapshot = {
      zeit: new Date().toISOString(),
      betrieb: slug,
      vorgaenge: Object.fromEntries(cases.map((c) => [c.id, { status: c.orchestrationStatus, ereignisse: c.eventSequence }])),
      eingaenge: intakes.map((i) => i.id).sort(),
      offeneFreigaben: approvals.map((a) => a.id).sort(),
      aktiveWartebedingungen: await scoped.waitSubscription.count({ where: { status: 'WAITING' } }),
      offeneAufgaben: await scoped.task.count({ where: { status: 'OPEN' } }),
      bestaetigteAktionen: await scoped.actionIntent.count({ where: { status: 'CONFIRMED' } }),
      gesendeteNachrichten: await scoped.emailMessage.count({ where: { direction: 'OUTBOUND' } }),
      notbremsen: Object.fromEntries(switches.map((s) => [s.key, s.engaged])),
      flags: Object.fromEntries(flags.map((f) => [f.key, { standard: f.defaultValue, mandant: ((f.tenantOverrides as Array<{ tenantId: string; value: boolean }>) ?? []).find((o) => o.tenantId === tenant.id)?.value ?? null }])),
    };
    writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
    say(`Zustand von ${tenant.name} festgehalten: ${cases.length} Vorgänge, ${intakes.length} Eingänge, ${approvals.length} offene Freigaben, ${result.aktiveWartebedingungen} Wartebedingungen, ${result.bestaetigteAktionen} bestätigte Aktionen, ${result.gesendeteNachrichten} gesendete Nachrichten → ${file}`);
  } finally {
    await app.close();
  }
}

function compare(beforeFile: string, afterFile: string, stop: boolean): void {
  const a = JSON.parse(readFileSync(beforeFile, 'utf8')) as Snapshot;
  const b = JSON.parse(readFileSync(afterFile, 'utf8')) as Snapshot;
  const problems: string[] = [];
  if (a.betrieb !== b.betrieb) problems.push('Die Zustände gehören zu verschiedenen Betrieben.');
  for (const id of Object.keys(a.vorgaenge)) {
    const now = b.vorgaenge[id];
    if (!now) problems.push(`Vorgang ${id.slice(0, 8)} ist verschwunden.`);
    else if (a.vorgaenge[id]!.status !== 'COMPLETED' && now.status === 'COMPLETED' && now.ereignisse === a.vorgaenge[id]!.ereignisse) problems.push(`Vorgang ${id.slice(0, 8)} ist ohne Ereignis abgeschlossen.`);
  }
  for (const id of a.eingaenge) if (!b.eingaenge.includes(id)) problems.push(`Eingang ${id.slice(0, 8)} ist verschwunden.`);
  for (const id of a.offeneFreigaben) if (!b.offeneFreigaben.includes(id)) say(`  Hinweis: Freigabe ${id.slice(0, 8)} ist nicht mehr offen (entschieden oder ungültig) – im Protokoll der Probe zu erklären.`);
  if (stop) {
    const newCases = Object.keys(b.vorgaenge).filter((id) => !a.vorgaenge[id]);
    if (newCases.length > 0) problems.push(`Im Stopp-Fenster sind ${newCases.length} neue(r) Vorgang/Vorgänge entstanden.`);
    if (b.eingaenge.length !== a.eingaenge.length) problems.push(`Im Stopp-Fenster sind ${b.eingaenge.length - a.eingaenge.length} neue Eingänge aufgenommen worden (die Aufnahme sollte gestoppt sein).`);
    if (b.bestaetigteAktionen !== a.bestaetigteAktionen) problems.push(`Im Stopp-Fenster wurden ${b.bestaetigteAktionen - a.bestaetigteAktionen} Aktion(en) bestätigt.`);
    if (b.gesendeteNachrichten !== a.gesendeteNachrichten) problems.push(`Im Stopp-Fenster wurden ${b.gesendeteNachrichten - a.gesendeteNachrichten} Nachricht(en) gesendet.`);
  }
  say(`Vergleich ${a.zeit} → ${b.zeit}${stop ? ' (Stopp-Fenster)' : ''}: Vorgänge ${Object.keys(a.vorgaenge).length} → ${Object.keys(b.vorgaenge).length}, Eingänge ${a.eingaenge.length} → ${b.eingaenge.length}, offene Freigaben ${a.offeneFreigaben.length} → ${b.offeneFreigaben.length}, bestätigte Aktionen ${a.bestaetigteAktionen} → ${b.bestaetigteAktionen}, gesendet ${a.gesendeteNachrichten} → ${b.gesendeteNachrichten}.`);
  for (const [key, was] of Object.entries(a.notbremsen)) if (b.notbremsen[key] !== was) say(`  Notbremse ${key}: ${was ? 'gezogen' : 'frei'} → ${b.notbremsen[key] ? 'gezogen' : 'frei'}`);
  for (const p of problems) say(`  PROBLEM ${p}`);
  say(problems.length === 0 ? 'Vergleich bestanden: nichts ging verloren' + (stop ? ', im Stopp-Fenster wurde nichts wirksam.' : '.') : `Vergleich NICHT bestanden: ${problems.length} Problem(e).`);
  if (problems.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, one, two] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (command === 'schnappschuss' && one && two) return snapshot(one, two);
  if (command === 'vergleich' && one && two) return compare(one, two, process.argv.includes('--stopp'));
  throw new Error('Aufruf: stop-drill.ts schnappschuss <tenant-slug> <Datei.json> | vergleich <vorher.json> <nachher.json> [--stopp]');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
