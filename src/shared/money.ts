import { CURRENCY_EXPONENTS, currencySchema, type Money } from './contracts';

export type MoneyFormat = {
  currency: string;
  locale: string;
  format: 'machine' | 'localized';
};

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseMoney(value: unknown, options: MoneyFormat): Money | null {
  const currency = currencySchema.safeParse(options.currency);
  if (!currency.success) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || options.format !== 'machine')) return null;
  const exponent = CURRENCY_EXPONENTS[currency.data];
  let text = String(value).trim();
  if (!text || text.length > 64) return null;

  try {
    if (Intl.NumberFormat.supportedLocalesOf([options.locale]).length !== 1) return null;
    if (options.format === 'localized') {
      const parts = new Intl.NumberFormat(options.locale).formatToParts(12345.6);
      const group = parts.find((part) => part.type === 'group')?.value;
      const decimal = parts.find((part) => part.type === 'decimal')?.value;
      if (!group || !decimal) return null;
      const fraction = exponent > 0 ? `(?:${escapePattern(decimal)}[0-9]{1,${exponent}})?` : '';
      const pattern = new RegExp(`^(?:[0-9]+|[1-9][0-9]{0,2}(?:${escapePattern(group)}[0-9]{3})+)${fraction}$`);
      if (!pattern.test(text)) return null;
      text = text.split(group).join('').replace(decimal, '.');
    }

    const fraction = exponent > 0 ? `(?:\\.[0-9]{1,${exponent}})?` : '';
    if (!new RegExp(`^[0-9]+${fraction}$`).test(text)) return null;
    const [whole, decimals = ''] = text.split('.');
    const amountMinor = BigInt(`${whole}${decimals.padEnd(exponent, '0')}`);
    if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { amountMinor: Number(amountMinor), currency: currency.data, exponent };
  } catch {
    return null;
  }
}