import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { loadEnv } from '@orbit/config';

/**
 * docs/OBSERVABILITY.md — OpenTelemetry auto-instrumentation patches
 * Node's module loader (require-in-the-middle) to wrap `http`/`ioredis`/
 * `pino`/etc. at the moment each is first `require()`d. `startTracing()`
 * therefore MUST be called before anything else is imported in an entry
 * file (`main.ts`/`worker/main.ts`) — importing `AppModule`/`WorkerModule`
 * first would transitively `require()` all of those before this file has
 * had a chance to patch them, and nothing would get instrumented.
 * `@nestjs/instrumentation-fs` is explicitly disabled: it traces every
 * single filesystem call (including ones Node itself makes internally)
 * and drowns out everything else in a trace view without adding value
 * here. Pino's own instrumentation only injects trace/span-ID fields
 * into log records (log correlation, §31) — `disableLogSending` turns
 * off its separate, unrelated ability to forward logs into an OTEL Logs
 * pipeline, which this phase deliberately does not set up (see
 * docs/OBSERVABILITY.md, "Bewusst außerhalb des Scopes").
 */
export function startTracing(serviceName: string): void {
  const env = loadEnv();
  if (!env.OTEL_ENABLED) {
    return;
  }
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    console.warn(`[otel] OTEL_ENABLED=true, aber OTEL_EXPORTER_OTLP_ENDPOINT ist leer (${serviceName}) — Tracing wird nicht gestartet.`);
    return;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((error: unknown) => console.error('[otel] Fehler beim Herunterfahren des SDK', error))
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log(`[otel] Tracing gestartet (service=${serviceName}, endpoint=${env.OTEL_EXPORTER_OTLP_ENDPOINT})`);
}
