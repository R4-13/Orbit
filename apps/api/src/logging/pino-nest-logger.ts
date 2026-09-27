import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

/**
 * Adapts a `pino.Logger` to NestJS's `LoggerService` interface so
 * `app.useLogger()` (main.ts/worker/main.ts) replaces Nest's built-in
 * console `Logger` app-wide — closes docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md
 * §63 ("Actually wire a structured logger such as pino"), correcting the
 * false "✅ Strukturiertes Logging (pino/pino-http)" claim found and
 * fixed in docs/MASTER_SPEC_GAP_ANALYSIS.md §41 during Phase 25 —
 * `pino`/`pino-http` were dependencies since Phase 1 but never actually
 * used as the logger.
 *
 * Nest calls `log(message, context)` / `error(message, trace, context)`
 * / etc. — the last string argument is conventionally the calling
 * class's name (`context`), extracted here into a structured field
 * rather than concatenated into the message text.
 */
export class OrbitPinoLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.pino.info(this.bindings(optionalParams), this.text(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const [trace, context] = this.splitErrorParams(optionalParams);
    this.pino.error({ ...(context ? { context } : {}), ...(trace ? { trace } : {}) }, this.text(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.pino.warn(this.bindings(optionalParams), this.text(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.pino.debug(this.bindings(optionalParams), this.text(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.pino.trace(this.bindings(optionalParams), this.text(message));
  }

  private text(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }

  private bindings(optionalParams: unknown[]): Record<string, unknown> {
    const context = optionalParams.find((p): p is string => typeof p === 'string');
    return context ? { context } : {};
  }

  /** error(message, context) and error(message, trace, context) are both valid Nest call shapes. */
  private splitErrorParams(optionalParams: unknown[]): [trace: string | undefined, context: string | undefined] {
    const strings = optionalParams.filter((p): p is string => typeof p === 'string');
    if (strings.length >= 2) return [strings[0], strings[1]];
    if (strings.length === 1) return [undefined, strings[0]];
    return [undefined, undefined];
  }
}
