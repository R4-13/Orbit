import { describe, expect, it } from 'vitest';
import {
  ToolFailedError,
  ToolOutcomeUnknownError,
  classifyThrownToolError,
  normalizeToolOutput,
} from './tool-result';

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
