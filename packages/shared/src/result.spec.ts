import { describe, expect, it } from 'vitest';
import { err, ok } from './result';

describe('Result helpers', () => {
  it('ok() produces a success Result carrying the value', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('err() produces a failure Result carrying the error', () => {
    const result = err('DUPLICATE_FOUND');
    expect(result).toEqual({ ok: false, error: 'DUPLICATE_FOUND' });
  });
});
