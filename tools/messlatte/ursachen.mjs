#!/usr/bin/env node
// Teilt die wartenden und übergebenen Fälle eines Messlaufs nach Ursache auf (fünf Gruppen laut Auftraggeber 21.10.2026). Grundlage sind die Rohdaten der Auswertung
// (docs/evidence/messlauf-60/auswertung-<name>.json): Klasse, Grund, Wortlaut der ausgehenden Mails, Teilvorgänge. Die Zuordnung steht je Szenario ausdrücklich im Code
// (Regeln unten), jede Zeile nennt ihre Begründung – nichts wird gelockert, um bessere Zahlen zu erhalten.
//   node tools/messlatte/ursachen.mjs zustand-B
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'evidence', 'messlauf-60');
const name = process.argv[2] ?? 'zustand-B';
const data = JSON.parse(readFileSync(join(OUT, `auswertung-${name}.json`), 'utf8'));

const G = {
  FREIGABE: 'notwendige Freigabe',
  KUNDENINFO: 'tatsächlich fehlende Kundeninformation',
  FAEHIGKEIT: 'fehlende Fähigkeit',
  ENTSCHEIDUNG: 'fachlich erforderliche menschliche Entscheidung',
  VERMEIDBAR: 'vermeidbare Übergabe oder fehlerhafte Prozesssteuerung',
};

function sourceOf(reason) {
  return reason.replace(/\s+/g, ' ');
}

/** Ursache eines einzelnen wartenden/übergebenen Falls oder Teilvorgangs. */
function cause(item) {
  const s = item.szenario ?? '';
  const k = item.klasse;
  const why = item.grund ?? '';
  const mails = (item.ausgehend ?? []).at(-1)?.text ?? ''; // maßgeblich ist die letzte Nachricht an die Kundschaft: worauf wartet der Vorgang jetzt?
  const title = (item.anliegen ?? '').toLowerCase();
  // Teilvorgänge (Anliegen) zuerst
  if (title) {
    if (/weitere fragen und wünsche/.test(title)) return [G.VERMEIDBAR, 'überzähliger Teilvorgang aus verstümmeltem Auszug/Rest der Nachricht (Prozesssteuerung)'];
    if (/rechnung/.test(title)) return [G.FAEHIGKEIT, 'eine frühere Rechnung abrufen und bereitstellen kann ORBIT nicht (keine Fähigkeit); eine Person übernimmt'];
    if (/wartungstermin/.test(title)) return [G.FAEHIGKEIT, 'einen bestehenden Termin verschieben (Kalender ändern) ist in dieser Runde ausgeschlossen und als Fähigkeit nicht vorhanden'];
    if (/wasserhahn|reparaturtermin/.test(title)) return k === 'W' ? [G.FREIGABE, 'Plan wartet auf die Planfreigabe (unbekannte Vorgangsart, D4)'] : [G.ENTSCHEIDUNG, 'Terminoptionen prüfen und mit der Kundschaft abstimmen (Termin-Vergabe ist Sache einer Person, Buchungen in dieser Runde ausgeschlossen)'];
    if (/angebot|regler|thermostat/.test(title)) return k === 'W' ? (/WAITING_FOR_APPROVAL/.test(why) ? [G.FREIGABE, 'Plan wartet auf die Planfreigabe (D4)'] : [G.KUNDENINFO, 'Rückfrage an die Kundschaft gestellt']) : [G.ENTSCHEIDUNG, 'Angebot/Preis legt eine Person fest (kein Preis ohne Quelle)'];
    if (/erreichbar|telefon/.test(title)) return k === 'W' ? [G.FREIGABE, 'Auskunftsmail wartet auf Freigabe'] : [G.ENTSCHEIDUNG, 'Erreichbarkeit zu Zeiten außerhalb der Geschäftszeiten: keine belegte Auskunft im Betriebswissen, eine Person antwortet'];
    return [G.ENTSCHEIDUNG, 'Teilvorgang bei einer Person'];
  }
  if (k === 'W') {
    if (/WAITING_FOR_APPROVAL/.test(why)) return [G.FREIGABE, /umzug|wartungsvertrag|englische|elektro/.test(s) ? 'Plan wartet auf die Planfreigabe (unbekannte Vorgangsart, D4)' : 'Auskunftsmail wartet auf Einzelfreigabe der Regel email.send.information'];
    if (/preisfrage/.test(s)) return [G.VERMEIDBAR, 'reine Preisfrage wurde in den Terminablauf geführt (pauschaler Vor-Ort-Termin); gewartet wird auf eine Terminwahl, die für die Preisauskunft nicht nötig ist'];
    if (/benötigen wir noch folgende Angaben/.test(mails)) return [G.KUNDENINFO, 'gezielte Rückfrage nach fehlenden Angaben gestellt'];
    return [G.VERMEIDBAR, 'gewartet wird nur auf eine Terminwahl (keine fehlende Sachangabe)'];
  }
  if (k === 'U') {
    if (/notfall|heizung-ausfall/.test(s)) return [G.ENTSCHEIDUNG, 'Notfallverfahren: Person übernimmt (Eingangsbestätigung mit Notruf-Hinweis ging automatisch an die Kundschaft)'];
    if (/beschwerde/.test(s)) return [G.ENTSCHEIDUNG, 'Beschwerde/Reklamation: Prüfung, Entscheidung und Rückruf gehören einer Person'];
    if (/rechnung-lieferant/.test(s)) return [G.FAEHIGKEIT, 'automatische Rechnungsauslese nicht verfügbar (Platzhalter); Dokument gesichert, Person erfasst'];
    if (/phishing|prompt-injection/.test(s)) return [G.ENTSCHEIDUNG, 'Sicherheitsfall: Eingang liegt zur Prüfung vor, keine Aktion und keine Antwort (so beabsichtigt)'];
    if (/nur-hallo/.test(s)) return [G.VERMEIDBAR, 'Mail ohne Inhalt: eine kurze Rückfrage („Wie können wir helfen?“) wäre möglich gewesen; stattdessen Prüfliste'];
    if (/statusfrage/.test(s)) return [G.FAEHIGKEIT, 'Nachfrage nach einem früheren Vorgang, zu dem im System kein Bezug auffindbar ist: ORBIT kann ihn nicht zuordnen, eine Person prüft'];
    if (/umzug/.test(s)) return /Auf Antwort der Kundschaft warten/.test(why) ? [G.VERMEIDBAR, 'Status „Übergabe“, obwohl nur auf die Antwort der Kundschaft gewartet wird (das Warten war als menschliche Aufgabe geplant) – Prozesssteuerung'] : [G.ENTSCHEIDUNG, 'Umfang, Preis und Frist eines Installationsprojekts entscheidet eine Person'];
    if (/wartungsvertrag/.test(s) && /fester Vertriebsweg/.test(why)) return [G.VERMEIDBAR, 'fester Vertriebsweg: Lead und Aufgabe angelegt, aber keine Eingangsbestätigung und Status „in Bearbeitung“ ohne Verantwortliche (Verantwortung, Status und Kommunikation passten nicht zusammen)'];
    if (/elektro/.test(s)) return [G.ENTSCHEIDUNG, 'Leistung laut Betriebsprofil nicht im Angebot: eine Person entscheidet über die weitere Bearbeitung'];
    return [G.ENTSCHEIDUNG, 'bei einer Person'];
  }
  return [null, sourceOf(why)];
}

const rows = [];
for (const r of data.results.filter((x) => x.nr <= 60)) {
  if (r.teilvorgaenge?.length) {
    for (const t of r.teilvorgaenge) {
      if (!['W', 'U'].includes(t.klasse)) continue;
      const [group, begruendung] = cause({ klasse: t.klasse, grund: t.grund, anliegen: t.anliegen, szenario: r.szenario });
      rows.push({ nr: r.nr, szenario: r.szenario, einheit: `Teilvorgang „${t.anliegen}“`, klasse: t.klasse, gruppe: group, begruendung });
    }
  } else if (['W', 'U'].includes(r.klasse)) {
    const [group, begruendung] = cause(r);
    rows.push({ nr: r.nr, szenario: r.szenario, einheit: 'Mail', klasse: r.klasse, gruppe: group, begruendung });
  }
}
const count = (list) => Object.values(G).map((g) => [g, list.filter((x) => x.gruppe === g).length]);
const lines = [
  `# Ursachen der wartenden und übergebenen Fälle (${name})`,
  '',
  `Gezählt wird je Mail (ohne Aufteilung) bzw. je Teilvorgang (aufgeteilte Nachrichten): ${rows.length} Einheiten.`,
  '',
  '| Ursache | Einheiten | davon wartend (W) | davon übergeben (U) |',
  '|---|---|---|---|',
  ...Object.values(G).map((g) => `| ${g} | ${rows.filter((x) => x.gruppe === g).length} | ${rows.filter((x) => x.gruppe === g && x.klasse === 'W').length} | ${rows.filter((x) => x.gruppe === g && x.klasse === 'U').length} |`),
  '',
  '| Nr | Szenario | Einheit | Klasse | Ursache | Begründung |',
  '|---|---|---|---|---|---|',
  ...rows.map((x) => `| ${x.nr} | ${x.szenario} | ${x.einheit} | ${x.klasse} | ${x.gruppe} | ${x.begruendung} |`),
];
writeFileSync(join(OUT, `ursachen-${name}.md`), lines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
writeFileSync(join(OUT, `ursachen-${name}.json`), JSON.stringify({ gruppen: Object.fromEntries(count(rows)), zeilen: rows }, null, 2), 'utf8');
console.log(lines.slice(0, 11).join(String.fromCharCode(10)));
