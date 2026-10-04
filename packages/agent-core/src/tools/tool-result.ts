/**
 * Amendment 02 §12.5 — a tool call that returns without throwing is not
 * proof of success. Adapters and tools signal failure in several shapes
 * (`success: false`, `{ ok: false }`, an error object, an HTTP-style
 * status code); this module maps all of them onto one typed contract so
 * the workflow engine never has to guess.
 */
export type ToolResultStatus = 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export interface ToolResultContract {
  status: ToolResultStatus;
  /** Stable, safe machine code (never a raw provider message). */
  errorCode?: string;
  /** Human-readable, business-level reason. */
  message?: string;
  /** Whether repeating the call can reasonably succeed. Never true for OUTCOME_UNKNOWN (reconcile first). */
  retryable?: boolean;
}

/**
 * Thrown (or returned wrapped) by a tool whose external effect may or may
 * not have happened — e.g. a timeout after a mail send was submitted. The
 * runtime must reconcile instead of blindly retrying (§15.2).
 */
export class ToolOutcomeUnknownError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode = 'OUTCOME_UNKNOWN') {
    super(message);
    this.name = 'ToolOutcomeUnknownError';
    this.errorCode = errorCode;
  }
}

/** A tool may throw this to declare a failure with an explicit, safe code and retry hint. */
export class ToolFailedError extends Error {
  readonly errorCode: string;
  readonly retryable: boolean;
  constructor(message: string, options: { errorCode?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ToolFailedError';
    this.errorCode = options.errorCode ?? 'TOOL_FAILED';
    this.retryable = options.retryable ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFrom(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return undefined;
}

/** Classifies a tool's *returned* value (not a thrown exception — see `classifyThrownToolError`). */
export function normalizeToolOutput(output: unknown): ToolResultContract {
  if (!isRecord(output)) return { status: 'SUCCEEDED' };

  const statusText = typeof output.status === 'string' ? output.status.toUpperCase() : undefined;
  const outcomeText = typeof output.outcome === 'string' ? output.outcome.toUpperCase() : undefined;
  if (statusText === 'OUTCOME_UNKNOWN' || outcomeText === 'OUTCOME_UNKNOWN') {
    return { status: 'OUTCOME_UNKNOWN', errorCode: 'OUTCOME_UNKNOWN', message: messageFrom(output.message) ?? 'Das Ergebnis der externen Aktion ist ungewiss.', retryable: false };
  }

  const httpStatus = typeof output.statusCode === 'number' ? output.statusCode : typeof output.httpStatus === 'number' ? output.httpStatus : undefined;
  const failedByFlag = output.success === false || output.ok === false;
  const failedByStatus = statusText === 'FAILED' || statusText === 'ERROR';
  const failedByHttp = httpStatus !== undefined && httpStatus >= 400;
  // A bare `error` field only counts when the value isn't a domain entity (entities carry an `id`).
  const failedByErrorField = output.error !== undefined && output.error !== null && output.error !== false && output.error !== '' && output.id === undefined;

  if (failedByFlag || failedByStatus || failedByHttp || failedByErrorField) {
    return {
      status: 'FAILED',
      errorCode: typeof output.errorCode === 'string' ? output.errorCode : failedByHttp ? `HTTP_${httpStatus}` : 'TOOL_RETURNED_ERROR',
      message: messageFrom(output.error) ?? messageFrom(output.message) ?? 'Das Tool hat einen Fehler gemeldet.',
      retryable: typeof output.retryable === 'boolean' ? output.retryable : failedByHttp ? httpStatus === 429 || httpStatus >= 500 : false,
    };
  }

  return { status: 'SUCCEEDED' };
}

/** Classifies an exception thrown by a tool. */
export function classifyThrownToolError(error: unknown): ToolResultContract {
  if (error instanceof ToolOutcomeUnknownError) {
    return { status: 'OUTCOME_UNKNOWN', errorCode: error.errorCode, message: error.message, retryable: false };
  }
  if (error instanceof ToolFailedError) {
    return { status: 'FAILED', errorCode: error.errorCode, message: error.message, retryable: error.retryable };
  }
  return {
    status: 'FAILED',
    errorCode: 'TOOL_EXCEPTION',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
