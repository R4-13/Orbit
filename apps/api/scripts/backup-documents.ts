/**
 * Sicherung und Prüfung des Dokumentenspeichers (MinIO/S3) – der Teil, den `pg_dump` nicht erfasst. Gesichert wird der GANZE Bucket (Dokumente und öffentliche Logos) in einen Ordner mit
 * Manifest (Schlüssel, Größe, SHA-256). ERST ANZEIGEN, DANN ÄNDERN: ohne `--execute` zählt das Skript nur und schreibt nichts.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @orbit/api exec ts-node scripts/backup-documents.ts sichern  <Zielordner> [--execute]   kopiert fehlende/geänderte Objekte (vorhandene mit gleichem Hash werden übersprungen)
 *   pnpm --filter @orbit/api exec ts-node scripts/backup-documents.ts pruefen  <Zielordner>              prüft die Sicherung: Dateien gegen Manifest, Manifest gegen den Bucket, Dokumente gegen ihre Prüfsumme
 *   pnpm --filter @orbit/api exec ts-node scripts/backup-documents.ts wiederherstellen <Zielordner> --praefix restore-probe/<Zeit>/ [--execute]
 *        legt die Objekte der Sicherung UNTER EINEM PROBE-PRÄFIX wieder im Bucket ab (nie über die echten Schlüssel) und liest sie zur Kontrolle zurück; das Präfix wird danach wieder entfernt
 *
 * Jede ändernde Ausführung hängt eine Zeile an `<Zielordner>/backup-protokoll.jsonl` (Zeit, Befehl, Zähler, Ergebnis). Zugangsdaten werden nie ausgegeben.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

interface ManifestEntry {
  key: string;
  sizeBytes: number;
  sha256: string;
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const say = (text = ''): void => void process.stdout.write(`${text}\n`);
/** Schlüssel → Dateipfad unterhalb von `objects/`; Schlüssel mit `..` oder absolutem Pfad werden nie geschrieben. */
function safePath(root: string, key: string): string {
  if (key.includes('..') || key.startsWith('/') || key.includes('\\')) throw new Error(`Unzulässiger Schlüssel: ${key}`);
  return join(root, 'objects', ...key.split('/'));
}

function readManifest(dir: string): ManifestEntry[] {
  const file = join(dir, 'manifest.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { objects: ManifestEntry[] }).objects : [];
}

function protocol(dir: string, line: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'backup-protokoll.jsonl'), `${JSON.stringify({ zeit: new Date().toISOString(), ...line })}\n`, 'utf8');
}

async function main(): Promise<void> {
  const [command, dirArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!['sichern', 'pruefen', 'wiederherstellen'].includes(command ?? '') || !dirArg) throw new Error('Aufruf: backup-documents.ts sichern|pruefen|wiederherstellen <Zielordner> [--execute] [--praefix …]');
  const execute = process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const storage = app.get(StorageService);
    const prisma = app.get(PrismaService);
    const known = readManifest(dirArg);
    const byKey = new Map(known.map((e) => [e.key, e]));

    if (command === 'sichern') {
      const objects = await storage.listObjects('');
      const next: ManifestEntry[] = [];
      let copied = 0;
      let skipped = 0;
      for (const object of objects) {
        const previous = byKey.get(object.key);
        const target = safePath(dirArg, object.key);
        if (previous && previous.sizeBytes === object.sizeBytes && existsSync(target) && sha256(readFileSync(target)) === previous.sha256) {
          next.push(previous);
          skipped += 1;
          continue;
        }
        if (!execute) {
          copied += 1;
          continue;
        }
        const bytes = await storage.getObjectBytes(object.key);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
        next.push({ key: object.key, sizeBytes: bytes.byteLength, sha256: sha256(bytes) });
        copied += 1;
      }
      const removedInBucket = known.filter((k) => !objects.some((o) => o.key === k.key)).length;
      say(`Bucket: ${objects.length} Objekte · zu kopieren: ${copied} · bereits gesichert (unverändert): ${skipped} · in der Sicherung, aber nicht mehr im Bucket: ${removedInBucket} (bleiben als Verlaufsstand erhalten).`);
      if (!execute) return void say('Nur angezeigt. Zum Sichern --execute angeben.');
      // Objekte, die im Bucket nicht mehr stehen, bleiben im Manifest (Sicherung ist ein Stand, kein Spiegel).
      for (const old of known) if (!next.some((n) => n.key === old.key)) next.push(old);
      writeFileSync(join(dirArg, 'manifest.json'), JSON.stringify({ erstellt: new Date().toISOString(), bucketObjekte: objects.length, objects: next.sort((a, b) => a.key.localeCompare(b.key)) }, null, 2), 'utf8');
      protocol(dirArg, { befehl: 'sichern', objekteImBucket: objects.length, kopiert: copied, uebersprungen: skipped, ergebnis: 'OK' });
      return void say(`Gesichert: ${copied} Objekt(e) kopiert, Manifest mit ${next.length} Einträgen geschrieben.`);
    }

    if (command === 'pruefen') {
      const problems: string[] = [];
      if (known.length === 0) problems.push('Kein Manifest oder leer: es wurde noch nichts gesichert.');
      for (const entry of known) {
        const file = safePath(dirArg, entry.key);
        if (!existsSync(file)) problems.push(`Datei fehlt: ${entry.key}`);
        else if (sha256(readFileSync(file)) !== entry.sha256) problems.push(`Prüfsumme der gesicherten Datei stimmt nicht: ${entry.key}`);
      }
      const objects = await storage.listObjects('');
      const missingInBackup = objects.filter((o) => !byKey.has(o.key));
      if (missingInBackup.length > 0) problems.push(`${missingInBackup.length} Objekt(e) im Bucket fehlen in der Sicherung (neuer als die Sicherung).`);
      const documents = await prisma.withRlsBypass((tx) => tx.document.findMany({ select: { storageKey: true, checksum: true, fileName: true } }));
      let documentsChecked = 0;
      const inBucket = new Set(objects.map((o) => o.key));
      const knownOrphans = new Set((process.env.BACKUP_KNOWN_ORPHANS ?? '').split(',').map((k) => k.trim()).filter(Boolean));
      for (const document of documents) {
        if (!inBucket.has(document.storageKey)) {
          // Bekannte Altlasten (vom Betreiber benannt, `BACKUP_KNOWN_ORPHANS=<Schlüssel>,<Schlüssel>`) werden gemeldet, aber nicht als Fehler gezählt.
          if (knownOrphans.has(document.storageKey)) say(`  Hinweis (bekannt): Dokument ${document.fileName}: Objekt fehlt im Bucket (${document.storageKey}).`);
          else problems.push(`Dokument ${document.fileName}: das Objekt fehlt im Bucket (${document.storageKey}).`);
          continue;
        }
        const entry = byKey.get(document.storageKey);
        if (!entry) continue; // fehlt-in-Sicherung ist oben gemeldet
        documentsChecked += 1;
        if (document.checksum && document.checksum !== entry.sha256) problems.push(`Dokument ${document.fileName}: Prüfsumme der Sicherung weicht von der gespeicherten ab.`);
      }
      say(`Sicherung: ${known.length} Objekte im Manifest · Bucket: ${objects.length} · Dokumente gegen ihre Prüfsumme geprüft: ${documentsChecked} von ${documents.length}.`);
      for (const p of problems) say(`  PROBLEM ${p}`);
      say(problems.length === 0 ? 'Prüfung bestanden: die Sicherung ist vollständig und unverändert.' : `Prüfung NICHT bestanden: ${problems.length} Problem(e).`);
      if (execute) protocol(dirArg, { befehl: 'pruefen', manifest: known.length, bucket: objects.length, probleme: problems.length });
      if (problems.length > 0) process.exitCode = 1;
      return;
    }

    // wiederherstellen
    const prefix = option('--praefix');
    if (!prefix || !/^restore-probe\/[\w.-]+\/$/.test(prefix)) throw new Error('--praefix restore-probe/<Zeit>/ angeben (nur dieses Probe-Präfix ist erlaubt; echte Schlüssel werden nie überschrieben).');
    say(`Wiederherstellungsprobe: ${known.length} Objekte unter „${prefix}“ ablegen, zurücklesen, vergleichen und das Präfix wieder entfernen.`);
    if (!execute) return void say('Nur angezeigt. Zum Ausführen --execute angeben.');
    let ok = 0;
    const problems: string[] = [];
    for (const entry of known) {
      const key = `${prefix}${entry.key}`;
      await storage.putObjectBytes(key, readFileSync(safePath(dirArg, entry.key)), 'application/octet-stream');
      if (sha256(await storage.getObjectBytes(key)) === entry.sha256) ok += 1;
      else problems.push(`Rücklesen weicht ab: ${entry.key}`);
      await storage.delete(key);
    }
    say(`Zurückgelesen und gleich: ${ok} von ${known.length}.`);
    for (const p of problems) say(`  PROBLEM ${p}`);
    protocol(dirArg, { befehl: 'wiederherstellen', praefix: prefix, objekte: known.length, gleich: ok, probleme: problems.length });
    if (problems.length > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
