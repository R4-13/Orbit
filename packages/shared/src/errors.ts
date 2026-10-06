/**
 * Business-level error types shared across the platform (see
 * docs/ARCHITECTURE.md §40 "Fehlerbehandlung"). API controllers and agent
 * tools throw these instead of raw Errors so the API layer can map them to
 * consistent HTTP status codes and the UI can render human-understandable
 * messages instead of stack traces.
 */

export abstract class OrbitError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  /** Whether retrying the same operation later might succeed. */
  abstract readonly retryable: boolean;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class IntegrationUnavailableError extends OrbitError {
  readonly code = 'INTEGRATION_UNAVAILABLE';
  readonly httpStatus = 503;
  readonly retryable = true;
}

export class AuthenticationExpiredError extends OrbitError {
  readonly code = 'AUTHENTICATION_EXPIRED';
  readonly httpStatus = 401;
  readonly retryable = false;
}

export class DuplicateInvoiceError extends OrbitError {
  readonly code = 'DUPLICATE_INVOICE';
  readonly httpStatus = 409;
  readonly retryable = false;
}

export class PolicyViolationError extends OrbitError {
  readonly code = 'POLICY_VIOLATION';
  readonly httpStatus = 403;
  readonly retryable = false;
}

export class ApprovalRequiredError extends OrbitError {
  readonly code = 'APPROVAL_REQUIRED';
  readonly httpStatus = 202;
  readonly retryable = false;
}

export class LowConfidenceError extends OrbitError {
  readonly code = 'LOW_CONFIDENCE';
  readonly httpStatus = 422;
  readonly retryable = false;
}

export class ExternalSystemError extends OrbitError {
  readonly code = 'EXTERNAL_SYSTEM_ERROR';
  readonly httpStatus = 502;
  readonly retryable = true;
}

export class TenantIsolationViolationError extends OrbitError {
  readonly code = 'TENANT_ISOLATION_VIOLATION';
  readonly httpStatus = 403;
  readonly retryable = false;
}

export class ValidationFailedError extends OrbitError {
  readonly code = 'VALIDATION_FAILED';
  readonly httpStatus = 400;
  readonly retryable = false;
}

export class NotFoundError extends OrbitError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  readonly retryable = false;
}

export class PermissionDeniedError extends OrbitError {
  readonly code = 'PERMISSION_DENIED';
  readonly httpStatus = 403;
  readonly retryable = false;
}

export function isOrbitError(error: unknown): error is OrbitError {
  return error instanceof OrbitError;
}

/** Amendment 03 §3.2: kritische Plattformoperation ohne aktuelles Step-up (erneute Passwortprüfung). */
export class StepUpRequiredError extends OrbitError {
  readonly code = 'STEP_UP_REQUIRED';
  readonly httpStatus = 403;
  readonly retryable = false;
}

/** Amendment 03 §3: die Plattformdomäne ist nicht konfiguriert (kein `PLATFORM_JWT_SECRET`) und daher ausgeschaltet. */
export class PlatformNotConfiguredError extends OrbitError {
  readonly code = 'PLATFORM_NOT_CONFIGURED';
  readonly httpStatus = 503;
  readonly retryable = false;
}
