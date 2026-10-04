import { z } from 'zod';

/**
 * Amendment 02 §7.2/§8.4 — typed validation of fact values. A candidate only
 * becomes a CONFIRMED fact through schema/source validation or a human
 * confirmation; this is the schema half. Types are an open registry keyed by
 * the `type` a Blueprint requirement declares, so a new process can reuse them
 * without engine changes.
 */
const emailSchema = z.string().email();
const nonEmptyString = z.string().trim().min(1);
const moneySchema = z.object({ amount: z.number().finite(), currency: z.string().length(3) }).strict();
const dateSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Kein gültiges Datum.');

export const FACT_VALUE_VALIDATORS: Record<string, z.ZodType<unknown>> = {
  email: emailSchema,
  string: nonEmptyString,
  number: z.number().finite(),
  boolean: z.boolean(),
  date: dateSchema,
  money: moneySchema,
  /** A free-form object with at least one entry (e.g. quantity_or_scope: { count: 3, unit: 'Stück' }). */
  object: z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, 'Das Objekt ist leer.'),
};

export type FactValidationResult = { valid: true } | { valid: false; reason: string };

export function validateFactValue(type: string | undefined, value: unknown): FactValidationResult {
  if (!type) return { valid: true };
  const validator = FACT_VALUE_VALIDATORS[type];
  // An unknown type is NOT silently accepted: the requirement references something this runtime cannot check.
  if (!validator) return { valid: false, reason: `Unbekannter Faktentyp "${type}".` };
  const parsed = validator.safeParse(value);
  return parsed.success ? { valid: true } : { valid: false, reason: parsed.error.issues.map((i) => i.message).join('; ') };
}

/** Order-independent JSON equality, so {a:1,b:2} equals {b:2,a:1}. */
export function factValuesEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
