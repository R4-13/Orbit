# Annahmen (ASSUMPTIONS)

Diese Datei dokumentiert eigenständig getroffene Architektur- und
Implementierungsentscheidungen gemäß §2 des Master-Prompts ("Wenn eine
Annahme erforderlich ist, entscheide eigenständig nach Best Practice und
dokumentiere sie hier"). Neue Annahmen werden fortlaufend ergänzt.

## Phase 1 — Repository & Infrastruktur

| # | Annahme | Begründung |
|---|---------|------------|
| 1 | Node.js 22 LTS als Zielversion | Aktuelle LTS zum Erstellungszeitpunkt, kompatibel mit NestJS 10 und Next.js 15 |
| 2 | pnpm 9.x + Turborepo 2.x für das Monorepo | Empfohlene Kombination für pnpm-Workspaces mit Remote-Caching-Option; im Master-Prompt explizit als bevorzugt genannt |
| 3 | NestJS 10.x, Next.js 15.x (App Router), React 19, Prisma 6.x, PostgreSQL 16 | Zum Erstellungszeitpunkt aktuelle, miteinander kompatible stabile Versionen; werden im Projekt gepinnt |
| 4 | API-Versionierung über URI-Präfix (`/api/v1/...`) statt Header-Versionierung | Explizit im Master-Prompt unter §42 gefordert (`/api/v1/...`), einfacher für Swagger-Dokumentation und Postman-Konsum |
| 5 | Worker läuft als separater NestJS-Application-Context-Prozess (kein HTTP-Server), gestartet aus demselben `apps/api`-Package | Vermeidet Code-Duplizierung zwischen API- und Worker-Prozess (geteilte Module), erfüllt aber die Vorgabe getrennter Prozesse/Container in docker-compose.yml |
| 6 | MinIO als S3-kompatibler Object Storage für lokale Entwicklung, produktiv jede S3-API-kompatible Lösung (z. B. STACKIT Object Storage) | Explizit in §5 und §53 gefordert |
| 7 | `CREDENTIAL_ENCRYPTION_KEY` wird als Base64-kodierter 256-Bit-Schlüssel erwartet (AES-256-GCM) | Entspricht §30; konkrete Implementierung folgt in Phase 5 |
| 8 | Branding-Werte (APP_NAME, BRAND_NAME, BRAND_LOGO, PRIMARY_DOMAIN, SUPPORT_EMAIL) werden ausschließlich über `@orbit/config` geladen, nirgends sonst hart kodiert | Explizite Vorgabe in §0 |
| 9 | Docker-Compose-Setup enthält zusätzlich eine `docker-compose.dev.yml` (nur Infrastruktur: Postgres/Redis/MinIO) für den Fall, dass Entwickler API/Web/Worker direkt auf dem Host laufen lassen möchten | Pragmatische Ergänzung, nicht explizit gefordert, verbessert lokale DX ohne die geforderte `docker compose up`-Fähigkeit (volles Setup in `docker-compose.yml`) zu beeinträchtigen |
| 10 | Root-Repository liegt lokal unter `/home/claude/orbit`; GitHub-Remote `R4-13/Orbit` ist als `origin` vorgesehen, aber der Session fehlte aktuell die Push-Berechtigung (siehe Chatverlauf) | Entwicklung wird lokal fortgesetzt und bei Freischaltung gepusht, um den Fortschritt nicht zu blockieren (§62) |

## Phase 1 — Lokale Verifikation (Nachtrag)

| # | Annahme | Begründung |
|---|---------|------------|
| 11 | `pnpm` wird lokal per `npm install -g pnpm@9` bereitgestellt statt per `corepack enable` | `corepack enable` schlägt auf diesem Windows-Host mit `EPERM` fehl, da es nach `C:\Program Files\nodejs\pnpx` schreiben will und der Prozess ohne Admin-Rechte läuft. `npm install -g pnpm` installiert stattdessen in den user-eigenen npm-Prefix (`%APPDATA%\npm`) und funktioniert ohne erhöhte Rechte. `packageManager` in der Root-`package.json` bleibt auf `pnpm@10.28.0` stehen (Zielversion für CI/Docker); lokal wurde mit `pnpm@9.15.9` verifiziert, was mit den `>=9.0.0`-Anforderungen kompatibel ist. |
| 12 | Root-`eslint.config.mjs` (Flat Config, ESLint 9) + separate `apps/web/eslint.config.mjs` (Next.js-Regeln via `FlatCompat`) ergänzt | Phase 1 hatte in keinem Package eine ESLint-Konfiguration angelegt; ESLint 9 findet ohne `eslint.config.*` gar keine Regeln und bricht mit Exit-Code 2 ab. Die Root-Config gilt für alle Packages ohne eigene Config (ESLint sucht von `cwd` nach oben), `apps/web` hat eine eigene Config, da Next.js eigene Regeln (`next/core-web-vitals`) benötigt. `@typescript-eslint/consistent-type-imports` wurde bewusst NICHT aktiviert, da NestJS-Konstruktor-Injection Klassen oft nur im Typ-Kontext referenziert, `reflect-metadata` zur Laufzeit aber den echten (Value-)Import braucht — ein `import type` würde die DI zur Laufzeit stillschweigend brechen. |
| 13 | `@types/node` als devDependency zu `packages/{shared,config,domain,agent-core,integration-core,testing}` ergänzt | Fehlte in Phase 1; `packages/config` nutzt `process.env`, `packages/shared` nutzt `Error.captureStackTrace`, beides ohne Node-Typen nicht auflösbar. Die übrigen Packages werden es ab Phase 2/5/6 brauchen (Prisma/Connectoren/ts-node-Seed). |
| 14 | `apps/api/test/` (Jest-E2E-Setup: `jest-e2e.json` + `app.e2e-spec.ts` gegen `/api/v1/health`) sowie `apps/api/jest.config.js` (Unit-Tests, `passWithNoTests: true`) neu angelegt | `package.json` referenzierte bereits `eslint src test` und `test:e2e`, aber weder das Verzeichnis noch eine Jest-Config existierten. Der E2E-Test deckt den einzigen bisher existierenden Endpoint ab; Unit-Tests folgen mit den Fachmodulen ab Phase 3. |
| 15 | `vitest run --passWithNoTests` für alle Packages, die noch keine echten Tests haben (Scaffold-only: `domain`, `agent-core`, `integration-core`, `testing`, `apps/web`) | Vermeidet einen künstlichen roten Build wegen "no test files found", ohne Platzhalter-Tests ohne Aussagekraft zu schreiben. `shared`, `config` und `ui` haben bereits echte Logik aus Phase 1 (Fehler-Klassen, Env-/Branding-Validierung, `cn()`-Helper) und dafür wurden echte Unit-Tests ergänzt. |
| 16 | Echter Bug in `packages/config/src/env.ts` gefunden und behoben: `z.coerce.boolean()` wandelt **jeden** nicht-leeren String (auch den String `"false"`) in `true` um | Zod's `coerce.boolean()` ruft intern `Boolean(value)` auf; für Env-Variablen (immer Strings) ist das falsch. Betraf `S3_FORCE_PATH_STYLE`, `COOKIE_SECURE`, `OTEL_ENABLED` — z. B. hätte `COOKIE_SECURE=false` in der `.env` real zu `cookie.secure = true` geführt. Ersetzt durch ein `z.enum(['true','false'])`-Schema mit explizitem Transform. |
| 17 | `next build` (Next.js `output: "standalone"`) schlägt lokal auf Windows mit `EPERM: symlink` fehl, sofern der Windows-Entwicklermodus nicht aktiv ist | Next.js legt beim Tracing der Standalone-Ausgabe Symlinks in `.next/standalone/node_modules` an; das erfordert unter Windows entweder Administratorrechte oder aktivierten Entwicklermodus (Einstellungen → Für Entwickler). Der produktive Build läuft ausschließlich im Docker-Linux-Container (`apps/web/Dockerfile`), wo Symlinks uneingeschränkt funktionieren — dort ist dieses Problem nicht vorhanden. Systemeinstellungen wurden bewusst nicht automatisiert geändert (siehe Sicherheitsrichtlinien); der Nutzer kann den Entwicklermodus bei Bedarf selbst aktivieren, falls native Windows-Builds außerhalb von Docker gewünscht sind. `next dev`, `next lint`, `tsc --noEmit` und alle Tests sind von diesem Problem nicht betroffen. |

Weitere Annahmen werden in den folgenden Phasen ergänzt.
