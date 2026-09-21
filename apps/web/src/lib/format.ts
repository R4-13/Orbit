/**
 * Prisma's `Decimal`-typed fields (amountGross, amountNet, vatAmount, ...)
 * serialize to a plain string over JSON — the API response is never
 * actually a Decimal instance client-side, even though the imported
 * `@orbit/domain` type says so. Accepting `unknown` here sidesteps that
 * type/runtime mismatch instead of fighting it with a cast at every call
 * site.
 */
export function formatAmount(value: unknown, currency: string): string {
  if (value === null || value === undefined) return '–';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(value));
}
