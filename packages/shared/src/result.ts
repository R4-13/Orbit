/**
 * A minimal Result type for operations where an expected failure (e.g. "no
 * duplicate found" vs "found a duplicate") should not be modeled as a
 * thrown exception. Prefer OrbitError subclasses (see errors.ts) for
 * exceptional/unexpected failures; use Result for expected branches in
 * domain logic such as duplicate detection or confidence thresholds.
 */
export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
