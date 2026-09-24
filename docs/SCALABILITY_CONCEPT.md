# Cloud-Skalierbarkeit — Konzept

**Update (Phase 22): Migrationsschritt 1+2 sind implementiert und live
verifiziert** — `QueueModule` (BullMQ/Redis, real angebunden statt nur
Dependency), `apps/api/worker` verarbeitet jetzt tatsächlich Jobs (statt
nur zu booten und sich sofort zu beenden), und
`POST /workflow-definitions/:key/trigger-async` läuft asynchron über
einen echten, separaten Worker-Prozess. Details:
`docs/IMPLEMENTATION_STATUS.md` und `docs/ASSUMPTIONS.md` Phase 22 —
dort auch eine wichtige **Korrektur** an diesem Dokument: die
ursprünglich vorgeschlagene Pro-Tenant-Concurrency-Begrenzung über
BullMQ-Job-Gruppen ist eine kostenpflichtige BullMQ-Pro-Funktion, nicht
im hier verwendeten Open-Source-Paket verfügbar (siehe eigener
Abschnitt unten).

**Update (Phase 23): Migrationsschritt 5 (`/health/ready`-Redis-Check)
und der erste der "Weiteren Skalierungsbausteine"
(Redis-gestütztes Rate-Limiting) sind implementiert und live
verifiziert** — Details: `docs/IMPLEMENTATION_STATUS.md` und
`docs/ASSUMPTIONS.md` Phase 23. **Weitere Korrektur** an diesem
Dokument: der unten ursprünglich genannte `ThrottlerStorageRedisService`
aus `@nestjs/throttler` **existiert nicht** — das Paket liefert kein
eingebautes Redis-`ThrottlerStorage`; verifiziert gegen die
tatsächlichen `.d.ts`-Exporte der installierten Version
(`@nestjs/throttler@^6.3.0`, siehe eigener Abschnitt unten). Schritt 3+4
(Frontend-Polling, Migration von `POST /intake/emails`) bleiben offen.

**Status der übrigen Abschnitte: Konzept.** Ausgelöst durch die
Entscheidung, Project ORBIT als Cloud-SaaS für viele gleichzeitige
Kunden zu betreiben, und bewusst **vor** der Vollendung der
agentischen Fähigkeiten (Sonde-Chatbot, siehe Projekt-Memory) priorisiert
— jede weitere interaktive Agenten-Fähigkeit sollte auf einer
asynchronen Grundlage aufsetzen, nicht später darauf umgebaut werden.
Dieses Dokument ergänzt den bereits bestehenden Abschnitt "Skalierung
(aktueller Stand)" in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) um das
konkrete Konzept für den größten dort offen benannten Punkt: die fehlende
Queue. Referenzierte Datei-/Zeilenangaben beziehen sich auf den Stand
nach Phase 21.

## Ist-Zustand: was schon skalierungsfreundlich ist

- **Multi-Tenancy als "Pooled"-Modell**: eine gemeinsame Postgres-Instanz,
  `tenant_id` + Row-Level Security + Anwendungs-Layer-Scoping
  (`packages/domain/src/tenant-scope.ts`) statt einer eigenen Datenbank
  pro Kunde — der Standardansatz für kosteneffizientes B2B-SaaS, siehe
  `docs/ARCHITECTURE.md` §8.
- **API/Web zustandslos** (JWT ohne Server-Session) — laut
  `docs/DEPLOYMENT.md` bereits als "mehrere Replicas hinter einem Load
  Balancer unproblematisch" dokumentiert.
- **Objektspeicher extern** (MinIO/S3) — App-Server tragen keinen
  Datei-State.
- **Die Queue-Infrastruktur war von Anfang an eingeplant, nur nie
  verdrahtet.** `@nestjs/bullmq`/`bullmq` stehen bereits in
  `apps/api/package.json`, Redis ist in `docker-compose.yml` für `api`
  **und** `worker` konfiguriert (`REDIS_URL`, bereits in
  `packages/config/src/env.ts` als Pflicht-Env-Var validiert), und
  `apps/api/worker/main.ts` trägt seit Phase 1 den Kommentar "Standalone
  BullMQ worker process... Queue processors are registered on
  WorkerModule as they're implemented in Phase 5 onward". Dieses
  Dokument holt exakt das nach.

## Die zentrale Lücke: synchrone Agenten-Ausführung

`IntakeService.handleIncomingEmail()` und `WorkflowRunnerService.trigger()`
(`apps/api/src/intake/`, `apps/api/src/workflows/`) führen die komplette
Tool-Aufruf-Schleife — bei einem echten LLM mehrere Sekunden Latenz pro
`AgentRuntime.runTurn()`-Iteration — blockierend innerhalb der
HTTP-Anfrage aus. Das hat drei Konsequenzen, die mit wachsender
Kundenzahl zunehmend ins Gewicht fallen:

1. **Kapazität**: jeder laufende Agent hält einen API-Request-Thread und
   eine DB-Verbindung für seine gesamte Dauer belegt — das limitiert die
   gleichzeitige Kapazität eines API-Prozesses deutlich früher als eine
   asynchrone Architektur es täte.
2. **Kein Retry/Backoff** bei transienten LLM-/Connector-Fehlern (bereits
   in `docs/MASTER_SPEC_GAP_ANALYSIS.md` als offen vermerkt) — ein
   einzelner Netzwerk-Hänger lässt den gesamten Lauf fehlschlagen, statt
   automatisch erneut zu versuchen.
3. **Kein "lauter Nachbar"-Schutz**: ein Tenant mit vielen gleichzeitigen
   Agent-Läufen kann die API-Kapazität für alle anderen Tenants
   mindern, weil nichts die Anzahl gleichzeitig laufender Jobs pro Tenant
   begrenzt.

## Zielbild

```
┌──────────┐  POST .../trigger   ┌──────────────┐   enqueue    ┌───────┐
│  Client  │ ───────────────────▶│  API-Replica │ ────────────▶│ Redis │
└──────────┘  ◀─────────────────  │ (zustandslos)│              │(BullMQ)│
              202 + runId          └──────────────┘              └───┬───┘
                                                                      │ dequeue
                    GET .../runs/:id (Polling)                       ▼
              ┌──────────────────────────────────┐          ┌───────────────┐
              │   Postgres (WorkflowRun/AgentRun) │◀─────────│ Worker-Replica │
              │   RLS + forTenantId() unverändert │  writes  │ (skaliert      │
              └──────────────────────────────────┘          │  unabhängig)   │
                                                              └───────────────┘
```

API-Prozesse reihen nur noch Jobs ein und antworten sofort; die
eigentliche `AgentRuntime.runTurn()`-Ausführung läuft im `worker`-Prozess
— beide Prozessarten skalieren unabhängig voneinander (mehr
gleichzeitige Kunden brauchen mehr Worker-Replicas, nicht zwingend mehr
API-Replicas). `WorkflowRunnerService`/`AgentDefinitionResolverService`
selbst ändern sich **nicht** — sie werden nur von einem anderen Aufrufer
(Queue-Processor statt HTTP-Controller) aufgerufen, exakt dieselbe
"additiv, nicht ersetzend"-Philosophie wie bei
`docs/AGENT_STUDIO_CONCEPT.md`.

## Konkretes Queue-Design

### Neues `QueueModule` (`apps/api/src/queue/`)

```ts
BullModule.forRootAsync({
  inject: [ORBIT_ENV],
  useFactory: (env: OrbitEnv) => ({ connection: { url: env.REDIS_URL } }),
});
BullModule.registerQueue({ name: 'workflow-runs' });
```

Ein einzelner Queue-Name (`workflow-runs`) für diese erste Stufe — kein
separates Queue-Design pro Job-Typ, solange nur ein Job-Typ existiert;
weitere Queues (`document-processing`, `webhook-delivery`, ...) folgen
bei Bedarf, wenn ihre jeweiligen Konsumenten gebaut werden (Connector-
Sync, echte Webhook-Verarbeitung — siehe `docs/KNOWN_LIMITATIONS.md`).

### Job-Payload

```ts
interface WorkflowRunJobData {
  tenantId: string;
  actorUserId: string;
  workflowKey: string;
  input: Record<string, unknown>;
}
```

Bewusst **keine** vom Client änderbaren Ausführungsparameter (z. B.
`maxToolIterations`) im Job — dieselbe Überlegung wie beim bestehenden
`WorkflowRunnerService`: die Ausführungslogik bleibt serverseitig
vollständig bestimmt, ein Client kann nur *was* (welcher Workflow, welche
Eingabe) beeinflussen, nie *wie*.

### Prozessor (`apps/api/worker/`)

```ts
@Processor('workflow-runs')
class WorkflowRunProcessor extends WorkerHost {
  constructor(private readonly runner: WorkflowRunnerService) { super(); }
  async process(job: Job<WorkflowRunJobData>) {
    return this.runner.trigger(job.data.tenantId, job.data.actorUserId, job.data.workflowKey, job.data.input);
  }
}
```

`WorkerModule` importiert dafür dieselben Module wie `AppModule`
(`AgentDefinitionsModule`, `ApprovalsModule`, `PrismaModule`, ...) — der
Worker-Prozess braucht dieselbe DI-Verdrahtung wie die API, nur ohne
HTTP-Controller. `WorkflowRunnerService` selbst bleibt unverändert
wiederverwendbar, egal ob synchron (HTTP-Controller) oder asynchron
(Queue-Processor) aufgerufen.

### Retry/Backoff

BullMQ bringt das bereits eingebaut mit (`attempts`, `backoff: {type:
'exponential', delay: ...}` pro Job) — schließt direkt die in
`docs/MASTER_SPEC_GAP_ANALYSIS.md` §31 benannte Lücke ("Retry mit
Backoff für Integrationsfehler: nicht implementiert"). Wichtig:
`WorkflowRunnerService.trigger()` erzeugt bei jedem Aufruf einen neuen
`WorkflowRun`-Datensatz — ein Retry darf **keinen** neuen `WorkflowRun`
anlegen, sondern muss denselben fortsetzen oder ersetzen, sonst
entstehen bei jedem Retry doppelte, verwirrende Läufe. Das ist die
wichtigste noch zu klärende technische Detailfrage vor der vollen
Umsetzung (siehe "Offene Fragen" unten) — für die erste, additive Stufe
dieses Konzepts ist `attempts: 1` (kein automatischer Retry) daher die
sichere Starteinstellung, bis diese Idempotenz-Frage entschieden ist.

### Pro-Tenant-Concurrency-Begrenzung — **Korrektur nach Prüfung**

Ursprünglich in diesem Konzept vorgesehen: BullMQs Job-Gruppen
(`group: { id: tenantId }`) für eine harte Parallelitätsgrenze pro
Tenant. **Beim Implementieren verifiziert und korrigiert**: Job-Gruppen
sind eine **BullMQ-Pro-Funktion (kostenpflichtig)** — das installierte
Open-Source-`bullmq`-Paket (`package.json`: `"bullmq": "^5.34.4"`) kennt
kein `group`-Feld in seinen `JobsOptions` (geprüft gegen die
tatsächlichen Typdefinitionen der installierten Version). Der
"lauter Nachbar"-Schutz ist damit **weiterhin ein offener Punkt**, nicht
Teil dieser ersten Umsetzungsstufe. Mit reinem Open-Source-BullMQ
verfügbare Alternativen, keine davon bisher umgesetzt:

- `Worker`s `limiter`-Option begrenzt den **gesamten** Durchsatz eines
  Workers (Jobs pro Zeitfenster), nicht pro Tenant — ein grober, aber
  sofort verfügbarer Schutz gegen eine komplett überlastete Instanz.
- Ein selbst gebauter Zähler (z. B. ein Redis-`INCR`/`EXPIRE`-Schlüssel
  pro `tenantId`, im Processor vor der Ausführung geprüft, Job bei
  Überschreitung mit `Worker.rateLimit()`/manuellem Re-Queue
  zurückgestellt) — mehr Aufwand, aber echte Pro-Tenant-Grenze ohne
  BullMQ Pro.
- BullMQ Pro lizenzieren — reine Kostenentscheidung, kein technisches
  Hindernis.

Für die aktuelle, additive erste Stufe (`workflow-runs`-Queue, ein
Job-Typ) ist das Risiko gering — bewusst als offener Punkt für die
nächste Ausbaustufe festgehalten, nicht stillschweigend als gelöst
behauptet.

### Status-Abfrage

`WorkflowRun`/`WorkflowStepRun` (bereits vorhandenes Datenmodell aus
Phase 21) bleiben die alleinige Quelle für den Ausführungsstatus — der
bestehende `GET /workflow-definitions/:key/runs`-Endpunkt funktioniert
unverändert für Polling, kein neuer Job-Status-Endpunkt nötig. Die
Job-ID selbst wird nicht dem Client exponiert (sie ist eine reine
BullMQ-interne Ausführungsdetail), sondern die bereits vorhandene
`WorkflowRun.id`.

## Migrationspfad (additiv, gestuft)

Dieselbe Vorsicht wie im Migrationsabschnitt von
`docs/AGENT_STUDIO_CONCEPT.md` (dort: `WorkflowRunner` neben
`IntakeService`, nicht anstelle davon):

1. ✅ **`QueueModule` + `WorkerModule`-Prozessor bauen**, ohne einen
   bestehenden Endpunkt zu ändern — reine neue Infrastruktur.
   **Umgesetzt (Phase 22)**: `apps/api/src/queue/`, `WorkflowRunProcessor`
   (`apps/api/worker/`), `WorkflowRunnerService.trigger()` intern in
   `createRun()`+`executeRun()` gesplittet (verhaltenserhaltend, alle
   bestehenden Tests unverändert grün).
2. ✅ **Ersten Verbraucher additiv einführen**: ein neuer Endpunkt
   `POST /workflow-definitions/:key/trigger-async` (202 + `WorkflowRun.id`)
   **neben** dem bestehenden, synchronen `POST .../trigger` — Letzterer
   bleibt unverändert nutzbar (u. a. von `/admin/workflows`s
   "Ausführen"-Button, der eine sofortige Ergebnisanzeige erwartet).
   **Umgesetzt (Phase 22)**: live per `curl` verifiziert (202 in
   ~109ms, Worker-Prozess schließt den Lauf ~170ms später ab) und per
   neuem E2E-Test (`workflow-async-trigger.e2e-spec.ts`, bootstrapt
   `WorkerModule` als echten zweiten, separaten
   NestJS-Application-Context neben der API — derselbe Aufbau wie in
   Produktion, nur beide Prozesse im selben Testlauf).
3. **Frontend um einen asynchronen Modus ergänzen** (Polling gegen
   `GET .../runs`, "Läuft..."-Anzeige) — erst nachdem Schritt 2 bewiesen
   ist.
4. **`POST /intake/emails` erst danach migrieren**, wenn Schritt 2/3
   produktionsreif sind — dieser Endpunkt ist der am stärksten
   getestete, am längsten laufende Pfad im System
   (`intake-workflow.e2e-spec.ts`, `finance-workflow.e2e-spec.ts`,
   `sales-workflow.e2e-spec.ts`, `/inbox`-Frontend) und verdient die
   größte Vorsicht — dieselbe Begründung, aus der
   `docs/AGENT_STUDIO_CONCEPT.md` einen 1:1-Nachbau des Finance-Pfads
   als eigene `WorkflowDefinition` bislang zurückgestellt hat.
5. ✅ **`/health/ready`** um einen echten Redis-Konnektivitäts-Check
   erweitern — **umgesetzt (Phase 23)**:
   [`health.controller.ts`](../apps/api/src/health/health.controller.ts)
   nutzt den ohnehin injizierten BullMQ-Queue-Client
   (`(await this.queue.client).status === 'ready'`) statt eines
   separaten `redis.ping()` — BullMQs `IRedisClient`-Abstraktion
   exponiert bewusst kein `.ping()`/`.eval()`, `status` ist der
   dokumentierte, adapter-unabhängige Konnektivitäts-Indikator (siehe
   `docs/ASSUMPTIONS.md` Phase 23). Live per `docker stop/start
   orbit-redis` gegen den echten `/health/ready`-Endpunkt verifiziert
   (503 mit `redis: {status: "down", ...}` während gestopptem Redis,
   200 nach Neustart).

## Weitere Skalierungsbausteine (nach der Queue, absteigende Priorität)

1. ✅ **Redis-gestütztes Rate-Limiting** — `ThrottlerGuard` war zuvor
   In-Memory pro Prozess; bei mehreren API-Replicas hätte jede Instanz
   ihr eigenes, unabhängiges Limit-Budget statt eines gemeinsamen
   gehabt. **Umgesetzt (Phase 23) mit einer Korrektur gegenüber diesem
   Konzept**: `@nestjs/throttler` liefert **kein** eingebautes
   Redis-`ThrottlerStorage` (der hier ursprünglich genannte
   `ThrottlerStorageRedisService` existiert nicht — geprüft gegen die
   tatsächlichen Typ-Exporte der installierten Version). Stattdessen:
   [`ThrottlerRedisStorageService`](../apps/api/src/throttler/throttler-redis-storage.service.ts),
   eine eigene, Lua-Script-basierte Implementierung des
   `ThrottlerStorage`-Interfaces, die exakt die Semantik des
   In-Memory-Referenzcodes repliziert (inkl. der Eigenheit, dass der
   Trefferzähler eines bereits blockierten Schlüssels einfriert statt
   weiterzuzählen). Ein einzelnes `EVAL` pro Anfrage macht
   Inkrement+Block-Entscheidung atomar über alle Replicas hinweg —
   verifiziert durch reale Nebenläufigkeits-Integrationstests
   (`apps/api/test/throttler-redis-storage.e2e-spec.ts`, 10 parallele
   Anfragen gegen ein Limit von 5) und durch Beobachtung echter
   `throttler:*`-Schlüssel in Redis während laufendem API-Traffic. Details:
   `docs/ASSUMPTIONS.md` Phase 23.
2. **Connection-Pooler (PgBouncer)** zwischen App-Instanzen und
   Postgres — `DATABASE_URL_APP` trägt bereits `connection_limit=20`
   pro Instanz (`docs/DEPLOYMENT.md`); bei mehreren Replicas plus
   mehreren Worker-Replicas summiert sich das schnell gegen Postgres'
   `max_connections` (Default 100).
3. **Observability vor aggressiver horizontaler Skalierung** — nur ein
   `OTEL_ENABLED`-Flag existiert bisher (`docs/KNOWN_LIMITATIONS.md`),
   nicht verdrahtet. Ohne Metriken/Tracing bleibt ein "lauter Nachbar"
   oder eine langsame Query lange unsichtbar, bevor sie andere Tenants
   spürbar beeinträchtigt.
4. **Read Replicas** für lesehungrige, unkritische Pfade (DSGVO-Export,
   Dashboards, `/activity`) — trennt Berichtswesen-Last vom
   transaktionalen Schreibpfad. Erst relevant bei nachweisbarer
   Leselast, keine Vorab-Optimierung ohne echte Lastdaten.
5. **DB-Sharding / Tenant-Isolation auf Datenbankebene** — nur bei
   echtem Bedarf (sehr viele oder einzelne sehr große Kunden). Das
   gepoolte Modell (§8) trägt die meisten SaaS-Größenordnungen; das ist
   der letzte, nicht der erste Schritt.

## Sicherheits-/Tenant-Isolations-Überlegungen

- Jeder Queue-Job trägt `tenantId` explizit in seinem Payload — der
  Worker-Prozess ruft `WorkflowRunnerService.trigger()` mit genau diesem
  `tenantId` auf, das bestehende `forTenantId()`/RLS-Modell (§8) prüft
  und erzwingt die Isolation exakt wie im synchronen Pfad. Kein neuer
  Isolations-Mechanismus nötig — die Queue ist nur ein anderer Aufrufer
  derselben, bereits geprüften Funktion.
- Ein kompromittierter/fehlerhafter Job-Payload kann durch die
  bestehende `assertNotCrossTenant()`-Prüfung (`tenant-scope.ts`) nicht
  auf einen anderen Tenant zugreifen, selbst wenn ein Bug im
  Enqueue-Code versehentlich ein falsches `tenantId`-Feld mitgäbe — die
  Prisma-Extension würde das mit `TenantIsolationViolationError` hart
  ablehnen.
- Redis selbst enthält in dieser Stufe **keine** fachlichen Tenant-Daten,
  nur Job-Metadaten (IDs, `tenantId`-Referenz) — die eigentlichen
  Ergebnisse landen weiterhin ausschließlich in Postgres unter RLS.

## Offene Fragen

- **Retry-Idempotenz**: darf ein wiederholter Job-Versuch denselben
  `WorkflowRun`-Datensatz fortsetzen, oder muss `WorkflowRunnerService`
  dafür erst umgebaut werden (z. B. ein `resumeFromStep`-Parameter)? Bis
  geklärt: kein automatischer Retry (siehe oben).
- **Wie lange darf ein Job in der Warteschlange auf einen freien Worker
  warten**, bevor der Client eine Zeitüberschreitung sehen soll (falls
  überhaupt synchron gewartet wird)? Bei rein asynchronem
  Polling-Modell (Schritt 2/3 des Migrationspfads) weniger kritisch als
  bei einem hypothetischen synchronen "warte auf Ergebnis"-Modus.
- **Managed Redis in der Cloud** (ElastiCache/Memorystore) vs.
  selbst betriebenes Redis — reine Infrastruktur-/Kostenentscheidung,
  nicht Teil dieses Konzepts.
