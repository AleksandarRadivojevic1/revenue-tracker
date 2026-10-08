// Display helpers. Every amount is in its own native currency (EUR, USD or
// RSD). The EUR ⇄ RSD toggle converts EUR amounts only, at today's rate; USD
// is always shown as USD — today's rate is never applied to it.

const rsdFormat = new Intl.NumberFormat('sr-RS', { style: 'currency', currency: 'RSD', maximumFractionDigits: 0 });
const eurFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(amount, currency = 'EUR', settings) {
  if (currency === 'USD') return usdFormat.format(amount);
  if (currency === 'RSD') return rsdFormat.format(amount);
  if (settings?.display_currency === 'RSD') return rsdFormat.format(amount * (settings?.eur_to_rsd || 0));
  return eurFormat.format(amount);
}

/**
 * Format a { currency: amount } map (from money.js perCurrency) as one string,
 * e.g. "1.200,00 € · $500.00". Never sums across currencies. Zero entries are
 * dropped unless everything is zero.
 */
export function formatAmounts(byCurrency, settings, pick = (v) => v) {
  const entries = Object.entries(byCurrency).map(([c, v]) => [c, pick(v)]);
  const nonZero = entries.filter(([, v]) => Math.abs(v) > 0.004);
  const shown = nonZero.length ? nonZero : entries.slice(0, 1);
  if (shown.length === 0) return formatMoney(0, 'EUR', settings);
  return shown.map(([c, v]) => formatMoney(v, c, settings)).join(' · ');
}

export const CURRENCY_LABEL = { EUR: 'EUR (€)', USD: 'USD ($)', RSD: 'RSD (дин)' };

export function formatDate(iso) {
  if (!iso) return '—';
  // Serbian day-first numeric format: dd/mm/yyyy (en-GB gives exactly this).
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Billing period of a recurring charge, from its due date: "October 2026" / "oktobar 2026". */
export function periodLabel(iso, lang = 'en') {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (lang === 'en') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const months = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Unambiguous long date for US readers: "Sep 6, 2026" (06/09 reads as June 9 there). */
export function formatDateLong(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export const STATUS_META = {
  paid: { label: 'Paid', tone: 'mint' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  due_soon: { label: 'Due soon', tone: 'amber' },
  overdue: { label: 'Overdue', tone: 'red' },
};

// Payment state of an invoice (money.js invoiceState).
export const INVOICE_STATE_META = {
  paid: { label: 'Paid', tone: 'mint' },
  partial: { label: 'Part paid', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'red' },
  void: { label: 'Void', tone: 'red' },
};

export const FREQUENCY_LABEL = {
  one_time: 'One-time',
  monthly: '/mo',
  yearly: '/yr',
};
