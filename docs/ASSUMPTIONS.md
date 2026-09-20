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
| 10 | Root-Repository liegt lokal unter `/home/claude/orbit`; GitHub-Remote `R4-13/Orbit` ist als `origin` vorgesehen, aber der Session fehlt aktuell die Push-Berechtigung (siehe Chatverlauf) | Entwicklung wird lokal fortgesetzt und bei Freischaltung gepusht, um den Fortschritt nicht zu blockieren (§62) |

Weitere Annahmen werden in den folgenden Phasen ergänzt.
