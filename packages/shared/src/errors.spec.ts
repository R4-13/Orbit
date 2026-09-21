import { describe, expect, it } from 'vitest';
import {
  DuplicateInvoiceError,
  isOrbitError,
  NotFoundError,
  OrbitError,
  PermissionDeniedError,
} from './errors';

describe('OrbitError subclasses', () => {
  it('carries a stable code, httpStatus and retryable flag', () => {
    const error = new DuplicateInvoiceError('Rechnung bereits vorhanden', {
      invoiceId: 'inv_1',
    });

    expect(error.code).toBe('DUPLICATE_INVOICE');
    expect(error.httpStatus).toBe(409);
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Rechnung bereits vorhanden');
    expect(error.details).toEqual({ invoiceId: 'inv_1' });
    expect(error.name).toBe('DuplicateInvoiceError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OrbitError);
  });

  it('serializes to a JSON-safe shape without leaking the stack trace', () => {
    const error = new NotFoundError('Case nicht gefunden');

    expect(error.toJSON()).toEqual({
      code: 'NOT_FOUND',
      message: 'Case nicht gefunden',
      details: undefined,
    });
  });

  it('isOrbitError narrows unknown values raised anywhere in the call stack', () => {
    expect(isOrbitError(new PermissionDeniedError('nope'))).toBe(true);
    expect(isOrbitError(new Error('plain error'))).toBe(false);
    expect(isOrbitError('not an error')).toBe(false);
    expect(isOrbitError(undefined)).toBe(false);
  });
});
