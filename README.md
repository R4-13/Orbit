# Project ORBIT

> **Namenshinweis:** "ORBIT" ist ausschließlich ein Arbeits-/Projektname.
> Der endgültige Firmen-/Produktname steht noch nicht fest. Der Name ist
> daher nirgends fest in Architektur, Datenmodell, Domains oder
> Geschäftslogik verankert — siehe `packages/config/src/branding.ts`.

Multi-Tenant B2B-SaaS-MVP, das administrative Tätigkeiten in kleinen und
mittelständischen Unternehmen automatisiert. Schwerpunkt: End-to-End-
Automatisierung der Prozesse **Finance** (E-Mail → Rechnung → Buchungsvorschlag
→ Freigabe → DATEV/Lexware) und **Sales** (E-Mail/Anruf → Lead → CRM →
Follow-up). Siehe [`docs/PRODUCT_CONTEXT.md`](docs/PRODUCT_CONTEXT.md) für
den vollständigen fachlichen Kontext.

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Node.js, TypeScript, NestJS (modularer Monolith) |
| ORM / DB | Prisma, PostgreSQL |
| Queue / Cache | Redis, BullMQ |
| Object Storage | S3-kompatibel (lokal: MinIO) |
| Monorepo | pnpm workspaces, Turborepo |

## Repository-Struktur

```
/apps
  /web      Next.js Frontend
  /api      NestJS API + Worker-Entry-Point
/packages
  /domain           Prisma-Schema, generierter Client, Tenant-Repository-Helfer
  /agent-core       LLMProvider, Tool Registry, Policy Engine, Agenten
  /integration-core Connector-Interfaces + Mock-/Produktiv-Adapter
  /shared           Fehlertypen, Permissions, Policy-/Audit-Konstanten
  /config           Branding- und Env-Konfiguration (zentral, providerunabhängig)
  /ui               Geteilte React-Komponenten (Tailwind/shadcn-Basis)
  /testing          Test-Fixtures, Mock-Connector-Factories
/docs               Architektur-, Integrations- und Statusdokumentation
/infra              Infrastruktur-bezogene Konfiguration
/scripts            Hilfsskripte (Seed, Setup, CI)
```

## Lokale Entwicklung

Voraussetzungen: Node.js ≥ 20, pnpm ≥ 9, Docker.

```bash
cp .env.example .env
# .env bei Bedarf anpassen (insbesondere CREDENTIAL_ENCRYPTION_KEY generieren:
# openssl rand -base64 32)

pnpm install

# Infrastruktur (Postgres, Redis, MinIO) starten
docker compose -f docker-compose.dev.yml up -d

# Datenbank migrieren + Demo-Daten laden
pnpm prisma:migrate
pnpm prisma:seed

# API, Worker und Web parallel starten
pnpm dev
```

Alternativ die komplette Demo inkl. API/Web/Worker containerisiert:

```bash
docker compose up
```

Details: [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) (folgt in
Phase 16).

## Qualitätssicherung

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## Entwicklungsstatus

Das Projekt wird in 17 Phasen gemäß dem Master-Entwicklungsplan umgesetzt.
Aktueller Stand je Komponente: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).
Getroffene Architekturannahmen: [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).
Bekannte Einschränkungen: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)
(folgt in Phase 16).

## Lizenz

Proprietär / unveröffentlicht.
