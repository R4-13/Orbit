import { z } from 'zod';

/**
 * `z.coerce.boolean()` calls `Boolean(value)`, so any non-empty string
 * (including the literal text "false") coerces to `true`. Env vars are
 * always strings, so booleans need explicit "true"/"false" parsing instead.
 */
function booleanEnvVar(defaultValue: boolean) {
  return z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

/**
 * Central, validated environment schema for the whole platform.
 *
 * The API, worker and web apps all import this rather than reading
 * `process.env` ad hoc, so a missing/misconfigured variable fails fast at
 * startup with a clear message instead of surfacing as a runtime bug deep
 * in a connector.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Branding
  APP_NAME: z.string().default('Project ORBIT'),
  BRAND_NAME: z.string().default('Project ORBIT'),
  BRAND_LOGO: z.string().default('/branding/logo.svg'),
  PRIMARY_DOMAIN: z.string().default('orbit.local'),
  SUPPORT_EMAIL: z.string().email().default('support@orbit.local'),

  // Core
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  DEFAULT_LOCALE: z.string().default('de-DE'),
  SUPPORTED_LOCALES: z.string().default('de-DE,en-US'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /**
   * The connection the running app (not the Prisma CLI) actually uses —
   * a restricted, non-superuser role so Postgres Row-Level Security
   * policies apply (DATABASE_URL's role is a migration-owning superuser,
   * which always bypasses RLS). See docs/ASSUMPTIONS.md Phase 15.
   */
  DATABASE_URL_APP: z.string().min(1, 'DATABASE_URL_APP is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Object storage
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().default('orbit-documents'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanEnvVar(true),
  /**
   * The browser-reachable S3 endpoint for presigned URLs, if different
   * from S3_ENDPOINT. In docker-compose.yml, S3_ENDPOINT is the
   * Docker-internal hostname ("http://minio:9000") that only the api/
   * worker containers can resolve — a presigned URL built from it would
   * be unreachable from a real browser on the host. Optional: falls back
   * to S3_ENDPOINT everywhere else (host-based `pnpm dev`, tests), where
   * the two are already identical. See StorageService.
   */
  S3_PUBLIC_ENDPOINT: z.string().optional(),

  /**
   * Server-side enforcement of declared upload metadata before a
   * presigned URL is even issued — DocumentsService.createUploadUrl()
   * rejects a request exceeding this or with a MIME type outside the
   * allow-list. Comma-separated MIME list; default covers what the
   * Finance/Sales workflows actually attach (invoice PDFs/scans, common
   * office documents). See docs/SECURITY.md §5 for what this does *not*
   * cover (the actually-uploaded bytes are never verified against this
   * declaration — files never transit through the API process).
   */
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  ALLOWED_UPLOAD_MIME_TYPES: z
    .string()
    .default(
      'application/pdf,image/png,image/jpeg,image/tiff,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain',
    ),

  // Auth / security
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // ZERIONUS Platform Control Plane (Amendment 03) — eigene Sicherheitsdomäne mit eigenem Token-Secret.
  // Ohne PLATFORM_JWT_SECRET ist die Plattformdomäne ausgeschaltet (Anmeldung/Routen antworten 503) – nie ein geteiltes oder Standard-Secret.
  PLATFORM_JWT_SECRET: z.string().min(32, 'PLATFORM_JWT_SECRET must be at least 32 characters').optional(),
  PLATFORM_ACCESS_TTL: z.string().default('15m'),
  /** Absolute Obergrenze einer Plattformsitzung in Stunden; ein Refresh verlängert sie nie. */
  PLATFORM_SESSION_MAX_HOURS: z.coerce.number().positive().max(72).default(8),
  /** Dauer des Erhöhungsfensters nach einer erneuten Passwortprüfung (Step-up) für kritische Operationen. */
  PLATFORM_STEP_UP_MINUTES: z.coerce.number().positive().max(60).default(5),
  /** Plattformrichtlinie: längste Dauer einer Support-Session in Minuten (Amendment 03 §18.4) – kein Frontend-Standard. */
  PLATFORM_SUPPORT_SESSION_MAX_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  /** Takt der Überwachung der Hintergrundverarbeitung in Sekunden (0 = aus). Zustandswechsel stehen im Plattform-Audit. */
  PLATFORM_RUNTIME_MONITOR_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Optional: URL, an die jeder Zustandswechsel als JSON gesendet wird (http/https, nur Zahlen und Namen, keine Mandantendaten). Leer = kein Webhook. */
  PLATFORM_ALERT_WEBHOOK_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
  /** Betriebsumgebung der Control Plane (Amendment 03 §21). Unbekannte Werte gelten nie als production. */
  ORBIT_ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  /** Datenraum, der für die Modellauswahl (Amendment 03 §22) gilt, solange der Mandant keine eigene Region trägt. */
  ORBIT_DEFAULT_DATA_REGION: z.string().min(2).max(20).default('EU'),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1, 'CREDENTIAL_ENCRYPTION_KEY is required'),
  COOKIE_SECURE: booleanEnvVar(false),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // AI provider layer — platform-managed default (§35 "ORBIT-Managed AI").
  // A tenant's own BYOK override (§41 AIProviderConnection) is resolved at
  // runtime, not via env vars — see apps/api/src/ai-providers/.
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'mock']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  /** Amendment 02 §19.2: show the "Kein Geschäftsprozess ausgelöst" view by default. Unset = visible outside production, hidden (explicit filter) in production. */
  /** Outbound mail transport of the process engine. `simulated` records sends as SIMULATED receipts and sends nothing — for tests and demos without a mailbox that granted the send permission. */
  OUTBOUND_MAIL_MODE: z.enum(['gmail', 'simulated']).default('gmail'),
  UI_SHOW_EXCLUDED_INTAKE: z.enum(['true', 'false']).optional(),
  /** Live-Abgleich: simuliert abgeschlossene oder an einer fehlenden Verbindung blockierte Schritte werden automatisch live wiederholt, sobald der echte Weg verfügbar ist. */
  LIVE_UPGRADE_ENABLED: z.enum(['true', 'false']).default('true'),
  /** Nur Vorgänge, die in den letzten N Tagen bearbeitet wurden, werden live wiederholt (alte Vorgänge nie). */
  LIVE_UPGRADE_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Optional. Reasoning models (e.g. gpt-6-luna) only accept function tools on Chat Completions with 'none'. Unset = send nothing. */
  OPENAI_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),

  // Semantic triage thresholds (Amendment 02 §14.3) — configurable defaults to be calibrated on an evaluation catalogue, not product constants.
  TRIAGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  TRIAGE_EXCLUSION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),

  // Build identity (set at image build time) — recorded as part of live-test evidence (Amendment 02 §19.4).
  ORBIT_BUILD_COMMIT: z.string().optional().default(''),

  // OCR / STT
  OCR_PROVIDER: z.enum(['mock', 'tesseract']).default('mock'),
  STT_PROVIDER: z.enum(['mock', 'whisper']).default('mock'),

  // Finance connectors
  FINANCE_CONNECTOR: z.enum(['mock', 'datev', 'lexware']).default('mock'),
  DATEV_CLIENT_ID: z.string().optional().default(''),
  DATEV_CLIENT_SECRET: z.string().optional().default(''),
  DATEV_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  DATEV_REDIRECT_URI: z.string().optional().default(''),
  LEXWARE_CLIENT_ID: z.string().optional().default(''),
  LEXWARE_CLIENT_SECRET: z.string().optional().default(''),
  LEXWARE_REDIRECT_URI: z.string().optional().default(''),

  // Mail connectors
  MAIL_CONNECTOR: z.enum(['mock', 'microsoft', 'gmail']).default('mock'),
  MICROSOFT_CLIENT_ID: z.string().optional().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().optional().default(''),
  MICROSOFT_TENANT_ID: z.string().optional().default('common'),
  MICROSOFT_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default(''),
  GOOGLE_PUBSUB_TOPIC: z.string().optional().default(''),

  // Calendar connectors
  CALENDAR_CONNECTOR: z.enum(['mock', 'microsoft', 'google']).default('mock'),

  // CRM connectors
  CRM_CONNECTOR: z.enum(['mock', 'hubspot']).default('mock'),
  HUBSPOT_CLIENT_ID: z.string().optional().default(''),
  HUBSPOT_CLIENT_SECRET: z.string().optional().default(''),
  HUBSPOT_REDIRECT_URI: z.string().optional().default(''),

  // Telephony connectors
  TELEPHONY_CONNECTOR: z.enum(['mock', 'twilio']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_API_KEY: z.string().optional().default(''),
  TWILIO_API_SECRET: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_WEBHOOK_BASE_URL: z.string().optional().default(''),

  // Observability
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  OTEL_ENABLED: booleanEnvVar(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Tenant concurrency fairness (docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §62) — caps how many
  // WorkflowRuns a single tenant may have executing at once in the worker pool, so one tenant
  // can't exhaust all worker capacity for every other tenant.
  TENANT_MAX_CONCURRENT_WORKFLOW_RUNS: z.coerce.number().int().positive().default(5),

  // Channel Event Runtime (docs/CHANNEL_EVENT_RUNTIME_PLAN.md, Increment D) — how often the
  // scheduler fans out a sync job per connected, polling-capable Integration, and how many
  // concurrent sync jobs a single tenant may have running at once (deliberately much lower than
  // TENANT_MAX_CONCURRENT_WORKFLOW_RUNS — polling is lightweight and a tenant only has a handful
  // of connectors, not dozens of simultaneous workflow runs).
  CHANNEL_SYNC_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  TENANT_MAX_CONCURRENT_CHANNEL_SYNCS: z.coerce.number().int().positive().default(2),
});

export type OrbitEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` (or a supplied record) against the
 * schema above. Throws a descriptive error listing every invalid/missing
 * variable if validation fails — fail fast at process boot, not mid-request.
 */
export function loadEnv(raw: Record<string, string | undefined> = process.env): OrbitEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (result.data.PLATFORM_JWT_SECRET && result.data.PLATFORM_JWT_SECRET === result.data.JWT_SECRET) {
    throw new Error('Invalid environment configuration:\n  - PLATFORM_JWT_SECRET: must differ from JWT_SECRET (separate security domains)');
  }
  return result.data;
}
