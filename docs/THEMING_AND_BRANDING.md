# Theming und Branding (UI/UX v2)

Zugehörig zu UI-v2 §§ 20–21 und AC-18. Produktname, Logo und Domain sind **nie** hartcodiert; sie kommen aus `@orbit/config`
(`APP_NAME`, `BRAND_NAME`, `BRAND_LOGO`, `PRIMARY_DOMAIN`, `SUPPORT_EMAIL`) bzw. der Mandantenkonfiguration.

## 1. Tokens

`apps/web/src/app/globals.css` definiert die Tokens als CSS-Variablen (RGB-Tripel, damit Tailwind-Opazitäten funktionieren):

| Token | Standard | Bedeutung |
|---|---|---|
| `--brand-primary` (+ `-foreground`) | 22 102 216 | Primärfarbe (Links, Fokus, aktive Filter) |
| `--brand-secondary`, `--brand-accent` (+ `-foreground`) | `#0f172a`, 8 145 178 | Sekundär- und Akzentfarbe |
| `--nav-background`, `--nav-foreground`, `--nav-active-*` | `#0b2340` | Navigation |
| `--surface-page`, `--surface-card`, `--surface-muted` | `#f5f7fb`, `#fff`, `#f1f5f9` | Flächen |
| `--text-primary`, `--text-secondary`, `--text-muted`, `--border-default` | siehe CSS | Text und Rahmen |
| `--status-*` | siehe CSS | Statusfarben (nicht mandantenüberschreibbar) |

Radius der Karten: 12 px.

Statusfarben (Erfolg/Warnung/Fehler/Info) sind **nicht** durch die Kunden-CI überschreibbar. Status wird immer durch Symbol + Text getragen,
nicht durch Farbe allein.

## 2. Mandantenfarben

- Die Mandantenfarben werden über `useTenantBranding` geladen und sofort angewendet. Der Cache ist **je Mandant** geschlüsselt; ein
  Mandantenwechsel kann nie das Theme eines anderen zeigen. Beim Abmelden wird der Query-Cache geleert.
- Kontrastnormalisierung (`lib/theme-contrast.ts`, WCAG): Liegt die gewählte Primärfarbe unter 4,5:1 gegen Weiß, wird sie für Text und Links
  automatisch abgedunkelt; Navigation und Flächen erhalten passende Vorder-/Hintergrundpaare. Die Originalfarbe bleibt gespeichert.
- Die Adminseite *Branding* zeigt eine Live-Vorschau und benennt, wo und warum eine Farbe angepasst wurde; ungespeicherte Änderungen sind als
  solche markiert.

## 3. Logo

`TenantLogo` bindet das Mandantenlogo als `<img>` ein (keine Inline-SVG-Ausführung, kein Skript), bewahrt das Seitenverhältnis in einem festen
Container (176×40 px, im Rail-Modus 44×32 px) und fällt bei fehlendem oder defektem Bild auf den Firmennamen als Text (Rail: Anfangsbuchstabe)
zurück. Der Produktname kommt aus der Konfiguration (`NEXT_PUBLIC_BRAND_NAME`), nicht aus dem Code.

## 4. Persönliche Präferenzen

`orbit.ui.v1.<tenant>.<user>.*` in localStorage: Home-Karten (Reihenfolge/Sichtbarkeit innerhalb eines Höhenbudgets, Pflicht-Aufmerksamkeit bleibt),
Navigationsrail, Sonde-Breite, gespeicherte Ansichten. Eine Layoutversion migriert alte Einstellungen; „Zurücksetzen“ stellt den Standard her.
Präferenzen verändern nie fachliche Daten oder Berechtigungen.

## 5. Offene Punkte (ehrlich)

- Ein echter Zwei-Mandanten-Browsertest (Tenant A/B im selben Browser) ist nicht automatisiert; abgedeckt sind Cache-Schlüssel und
  Kontrastlogik per Unit-Test sowie die Adminvorschau (siehe Abnahmebericht AC-18: TEILWEISE).
- Dunkelmodus ist nicht Teil von v2.
