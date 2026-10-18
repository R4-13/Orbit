import { describe, expect, it } from 'vitest';
import {
  ToolFailedError,
  ToolOutcomeUnknownError,
  classifyThrownToolError,
  isTransientError,
  normalizeToolOutput,
} from './tool-result';
import { AiProviderUnavailableError, ExternalSystemError } from '@orbit/shared';

describe('normalizeToolOutput (Amendment 02 §12.5)', () => {
  it('treats entities and plain values as SUCCEEDED', () => {
    expect(normalizeToolOutput({ id: 'lead_1', status: 'NEW' }).status).toBe('SUCCEEDED');
    expect(normalizeToolOutput('ok').status).toBe('SUCCEEDED');
    expect(normalizeToolOutput(undefined).status).toBe('SUCCEEDED');
    expect(normalizeToolOutput([1, 2]).status).toBe('SUCCEEDED');
  });

  it.each([
    ['success: false', { success: false, message: 'Kein Kontakt.' }],
    ['ok: false', { ok: false, error: 'boom' }],
    ['status FAILED', { status: 'failed', message: 'x' }],
    ['status ERROR', { status: 'ERROR' }],
    ['HTTP 4xx', { statusCode: 404 }],
    ['HTTP 5xx', { httpStatus: 503 }],
    ['bare error string', { error: 'nicht gefunden' }],
    ['error object', { error: { message: 'nope' } }],
  ])('maps a returned failure (%s) to FAILED without any exception', (_label, output) => {
    expect(normalizeToolOutput(output).status).toBe('FAILED');
  });

  it('marks 429 and 5xx retryable, 4xx not', () => {
    expect(normalizeToolOutput({ statusCode: 429 }).retryable).toBe(true);
    expect(normalizeToolOutput({ statusCode: 502 }).retryable).toBe(true);
    expect(normalizeToolOutput({ statusCode: 400 }).retryable).toBe(false);
  });

  it('does not mistake a domain entity that carries an error-like field for a failure', () => {
    expect(normalizeToolOutput({ id: 'inv_1', error: 'historical note' }).status).toBe('SUCCEEDED');
  });

  it('maps an explicit unknown outcome and never allows a retry', () => {
    const result = normalizeToolOutput({ outcome: 'OUTCOME_UNKNOWN', message: 'Timeout nach Versand' });
    expect(result.status).toBe('OUTCOME_UNKNOWN');
    expect(result.retryable).toBe(false);
  });
});

describe('Ausfall der Verbindung ist wiederholbar, eine Ablehnung nicht', () => {
  it('Netz- und Zeitüberschreitungsfehler sowie nicht erreichbare Systeme gelten als vorübergehend', () => {
    expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientError(new Error('x', { cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }) }))).toBe(true);
    expect(isTransientError(new Error('Request timed out'))).toBe(true);
    expect(isTransientError(new ExternalSystemError('HubSpot nicht erreichbar', { provider: 'hubspot', status: 503, retryable: true }))).toBe(true);
    expect(isTransientError(new AiProviderUnavailableError('KI weg'))).toBe(true);
  });

  it('eine Ablehnung des Auftrags oder ein Programmfehler ist es nicht', () => {
    expect(isTransientError(new ExternalSystemError('HubSpot lehnt ab', { provider: 'hubspot', status: 400, retryable: false }))).toBe(false);
    expect(isTransientError(new Error('Kontakt hat keine E-Mail-Adresse'))).toBe(false);
    expect(isTransientError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isTransientError('fetch failed')).toBe(false);
  });

  it('wird als wiederholbarer Ausfall gemeldet, mit dem Namen des Systems', () => {
    expect(classifyThrownToolError(new TypeError('fetch failed'))).toMatchObject({ status: 'FAILED', errorCode: 'SYSTEM_UNREACHABLE', retryable: true });
    expect(classifyThrownToolError(new ExternalSystemError('x', { provider: 'hubspot', retryable: true })).message).toContain('„hubspot“');
    expect(classifyThrownToolError(new Error('Kontakt fehlt'))).toMatchObject({ errorCode: 'TOOL_EXCEPTION', retryable: false });
  });
});

describe('classifyThrownToolError', () => {
  it('classifies plain errors, declared failures and unknown outcomes', () => {
    expect(classifyThrownToolError(new Error('x'))).toMatchObject({ status: 'FAILED', errorCode: 'TOOL_EXCEPTION' });
    expect(classifyThrownToolError(new ToolFailedError('rate', { errorCode: 'RATE_LIMIT', retryable: true }))).toMatchObject({
      status: 'FAILED',
      errorCode: 'RATE_LIMIT',
      retryable: true,
    });
    expect(classifyThrownToolError(new ToolOutcomeUnknownError('timeout'))).toMatchObject({
      status: 'OUTCOME_UNKNOWN',
      retryable: false,
    });
  });
});
