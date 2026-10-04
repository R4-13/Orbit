/**
 * Money is computed in integer cents. Floating point never touches an amount that ends up in a quote
 * (Amendment 02 §10: prices come from a source and are computed deterministically, never by the model).
 */
export function toCents(amount: string | number | { toString(): string }): number {
  const text = typeof amount === 'string' ? amount : amount.toString();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Ungültiger Geldbetrag: ${text}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatEuro(cents: number): string {
  const [whole, fraction] = fromCents(cents).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped},${fraction} €`;
}

export interface PriceTier {
  minQuantity: number;
  unitPrice: string;
}

/** The unit price that applies at `quantity`: the tier with the highest `minQuantity` not above the quantity. */
export function unitPriceCentsFor(listUnitPrice: string, tiers: PriceTier[] | null | undefined, quantity: number): number {
  const applicable = (tiers ?? []).filter((t) => quantity >= t.minQuantity).sort((a, b) => b.minQuantity - a.minQuantity)[0];
  return toCents(applicable ? applicable.unitPrice : listUnitPrice);
}

export interface QuoteLine {
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
  netCents: number;
  taxRate: number;
}

export interface QuoteTotals {
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Tax is computed per tax rate on the summed net amount (not per line), the usual invoicing rounding. */
export function computeTotals(lines: QuoteLine[]): QuoteTotals {
  const netByRate = new Map<number, number>();
  for (const line of lines) netByRate.set(line.taxRate, (netByRate.get(line.taxRate) ?? 0) + line.netCents);
  let net = 0;
  let tax = 0;
  for (const [rate, amount] of netByRate) {
    net += amount;
    tax += Math.round((amount * rate) / 100);
  }
  return { netCents: net, taxCents: tax, grossCents: net + tax };
}

export function lineFor(item: { sku: string; name: string; unit: string; unitPrice: string; priceTiers?: PriceTier[] | null; taxRate: number }, quantity: number): QuoteLine {
  const unitPriceCents = unitPriceCentsFor(item.unitPrice, item.priceTiers, quantity);
  return { sku: item.sku, name: item.name, unit: item.unit, quantity, unitPriceCents, netCents: Math.round(unitPriceCents * quantity), taxRate: item.taxRate };
}
