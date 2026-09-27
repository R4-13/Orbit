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
  return result.data;
}
