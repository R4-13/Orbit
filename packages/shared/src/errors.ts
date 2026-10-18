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

/**
 * Konzept Flexible Autonomie §8.3 (Entscheidung D1): ein eigener KI-Schlüssel (BYOK) ist eine vom Betreiber je Mandant freigegebene Option (Flag `ai.byok`,
 * Standard AUS). Ohne Freigabe antworten die schreibenden Wege serverseitig mit diesem Fehler – unabhängig davon, was die Oberfläche zeigt.
 */
export class ByokNotEnabledError extends OrbitError {
  readonly code = 'BYOK_NOT_ENABLED';
  readonly httpStatus = 403;
  readonly retryable = false;
}

/** Konzept Flexible Autonomie §9.1: ein Vorgang wird nie gleichzeitig vom Altweg und von der Prozess-Engine bearbeitet. */
export class ProcessingPathConflictError extends OrbitError {
  readonly code = 'PROCESSING_PATH_CONFLICT';
  readonly httpStatus = 409;
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

/** `Idempotency-Key` wurde bereits für eine **andere** Anfrage verwendet (anderer Pfad oder anderer Inhalt) – ein Schlüssel gehört zu genau einer Anfrage. */
export class IdempotencyKeyReusedError extends OrbitError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly httpStatus = 422;
  readonly retryable = false;
}

/** Dieselbe Anfrage mit demselben `Idempotency-Key` läuft noch; die Antwort kann erst nach dem Ende wiederholt werden. */
export class IdempotentRequestInProgressError extends OrbitError {
  readonly code = 'IDEMPOTENT_REQUEST_IN_PROGRESS';
  readonly httpStatus = 409;
  readonly retryable = true;
}

/** Der Zugang muss zuerst das Passwort ändern (nach Zurücksetzen durch den Owner oder bei Startpasswort); bis dahin sind nur Passwortwechsel, Abmelden und die Kontoabfrage erlaubt. */
export class PasswordChangeRequiredError extends OrbitError {
  readonly code = 'PASSWORD_CHANGE_REQUIRED';
  readonly httpStatus = 403;
  readonly retryable = false;
}

/** Das Passwort stimmt, aber der Zugang verlangt einen zweiten Faktor (Code der Authenticator-App oder Wiederherstellungscode). */
export class MfaRequiredError extends OrbitError {
  readonly code = 'MFA_REQUIRED';
  readonly httpStatus = 401;
  readonly retryable = false;
}

/** Amendment 03 §3: die Plattformdomäne ist nicht konfiguriert (kein `PLATFORM_JWT_SECRET`) und daher ausgeschaltet. */
export class PlatformNotConfiguredError extends OrbitError {
  readonly code = 'PLATFORM_NOT_CONFIGURED';
  readonly httpStatus = 503;
  readonly retryable = false;
}

/**
 * Amendment 03 §10–§11: für diesen Aufruf darf kein Modell bedient werden (kein Pfad erfüllt Freigabe, Region, Datenrichtlinie, Verbindung oder
 * Gesundheit). Ehrlicher Blockzustand statt stillem Wechsel zu einem anderen Anbieter; `details.reasons` trägt stabile Codes.
 */
export class AiProviderUnavailableError extends OrbitError {
  readonly code = 'AI_PROVIDER_UNAVAILABLE';
  readonly httpStatus = 503;
  readonly retryable = true;
}
