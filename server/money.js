// Pure money/date logic. No I/O — unit-tested in money.test.js.

// Every money row carries its own native currency. Rows from before
// multi-currency support have none and are EUR. Totals are only ever summed
// within one currency — never add EUR and USD together.
export const CURRENCIES = ['EUR', 'USD', 'RSD'];
export const currencyOf = (row) => row?.currency || 'EUR';

/** Currencies present across any number of row lists, in CURRENCIES order. */
export function currenciesIn(...lists) {
  const seen = new Set(lists.flat().map(currencyOf));
  return CURRENCIES.filter((c) => seen.has(c));
}

/**
 * Today's business date (YYYY-MM-DD) in Belgrade, not UTC. The container runs
 * TZ=UTC on purpose (backups), so toISOString() would put anything done
 * between 00:00 and 01:00/02:00 local time on the previous day.
 */
export function businessToday(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
}

/** Add whole days to an ISO date (YYYY-MM-DD). */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Add months to an ISO date (YYYY-MM-DD), clamping day to end of month. */
export function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const daysInTarget = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(d, daysInTarget);
  const res = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));
  return res.toISOString().slice(0, 10);
}

/** Next due date for a given frequency. one_time returns null (nothing recurs). */
export function advanceDueDate(isoDate, frequency) {
  if (frequency === 'monthly') return addMonths(isoDate, 1);
  if (frequency === 'yearly') return addMonths(isoDate, 12);
  return null; // one_time
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(aIso, bIso) {
  const a = Date.UTC(...aIso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...bIso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86400000);
}

/**
 * Status of a scheduled charge relative to `today`.
 * paid | upcoming | due_soon (<=14d away) | overdue
 */
export function chargeStatus(nextDue, today, dueSoonDays = 14) {
  if (!nextDue) return 'paid';
  const diff = daysBetween(today, nextDue);
  if (diff < 0) return 'overdue';
  if (diff <= dueSoonDays) return 'due_soon';
  return 'upcoming';
}

/** Monthly-recurring-revenue contribution of one active income charge. */
export function chargeMrr(charge) {
  if (charge.direction !== 'income' || !charge.active) return 0;
  if (charge.frequency === 'monthly') return charge.amount;
  if (charge.frequency === 'yearly') return charge.amount / 12;
  return 0; // one_time doesn't recur
}

/**
 * Monthly-normalized cost of one active overhead (out-of-project expense).
 * Mirrors chargeMrr but for costs: yearly is spread across 12 months,
 * one_time recurs nothing. Inactive costs contribute nothing.
 */
export function overheadMonthly(overhead) {
  if (!overhead.active) return 0;
  if (overhead.frequency === 'monthly') return overhead.amount;
  if (overhead.frequency === 'yearly') return overhead.amount / 12;
  return 0; // one_time
}

/**
 * Roll up realized totals for a set of payments (actual money that moved),
 * counting only payments in `currency`. Processor fees on a payment (e.g.
 * Payoneer's cut) are expenses, so profit is the true net.
 * Returns { revenue, expenses, profit }.
 */
export function paymentsRollup(payments, currency = 'EUR') {
  let revenue = 0;
  let expenses = 0;
  for (const p of payments) {
    if (currencyOf(p) !== currency) continue;
    if (p.direction === 'income') revenue += p.amount;
    else if (p.direction === 'expense') expenses += p.amount;
    expenses += Number(p.fee) || 0;
  }
  return { revenue, expenses, profit: revenue - expenses };
}

/**
 * Realized totals grouped by calendar year (from paid_on), for one currency.
 * Project payments split by direction; overhead payments are all expenses.
 * Returns an array of { year, revenue, expenses, profit }, newest year first.
 */
export function yearlyRollup(payments, overheadPayments = [], currency = 'EUR') {
  const byYear = new Map();
  const bucket = (year) => {
    if (!byYear.has(year)) byYear.set(year, { year, revenue: 0, expenses: 0, profit: 0 });
    return byYear.get(year);
  };
  for (const p of payments) {
    if (currencyOf(p) !== currency) continue;
    const b = bucket(p.paid_on.slice(0, 4));
    if (p.direction === 'income') b.revenue += p.amount;
    else if (p.direction === 'expense') b.expenses += p.amount;
    b.expenses += Number(p.fee) || 0;
  }
  for (const p of overheadPayments) {
    if (currencyOf(p) !== currency) continue;
    bucket(p.paid_on.slice(0, 4)).expenses += p.amount;
  }
  for (const b of byYear.values()) b.profit = b.revenue - b.expenses;
  return [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * Per-project rollup in one currency: realized totals from payments + MRR from
 * active charges.
 */
export function projectRollup(charges, payments, currency = 'EUR') {
  const base = paymentsRollup(payments, currency);
  const mrr = charges
    .filter((c) => currencyOf(c) === currency)
    .reduce((s, c) => s + chargeMrr(c), 0);
  return { ...base, mrr };
}

/** Dashboard-wide rollup across everything. */
export function dashboardRollup(charges, payments, currency = 'EUR') {
  return projectRollup(charges, payments, currency);
}

/** Map each currency present in `lists` to fn(currency). */
export function perCurrency(lists, fn) {
  return Object.fromEntries(currenciesIn(...lists).map((c) => [c, fn(c)]));
}

/**
 * Payment value in RSD for the tax base. RSD payments are already RSD; any
 * other currency needs the NBS middle rate snapshotted on the payment itself —
 * today's settings rate is never applied to a historic payment. Returns null
 * when no rate has been entered yet.
 */
export function paymentRsd(p) {
  if (currencyOf(p) === 'RSD') return Number(p.amount) || 0;
  if (p.amount_rsd != null && p.amount_rsd !== '') return Number(p.amount_rsd);
  const rate = Number(p.nbs_rate_rsd) || 0;
  return rate > 0 ? Math.round((Number(p.amount) || 0) * rate * 100) / 100 : null;
}

/**
 * Freelancer (Frilenseri) tax base: gross RSD of foreign income per calendar
 * quarter. Domestic payments are excluded (the Serbian payer withholds);
 * payments without a channel predate foreign clients and count as domestic.
 * `dateField` is which date decides the quarter ('paid_on' or 'received_on'
 * — the accountant's call, so it's data, not code); received_on falls back to
 * paid_on when blank. Payments with no NBS rate yet are counted in
 * `missing_rate` and left out of the sum. Newest quarter first.
 */
export function quarterlyRollup(payments, dateField = 'paid_on') {
  const byQ = new Map();
  for (const p of payments) {
    if (p.direction !== 'income') continue;
    if (!p.channel || p.channel === 'domestic') continue;
    const date = (dateField === 'received_on' && p.received_on) || p.paid_on;
    const year = date.slice(0, 4);
    const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
    const key = `${year}-Q${q}`;
    if (!byQ.has(key)) byQ.set(key, { quarter: key, gross_rsd: 0, count: 0, missing_rate: 0 });
    const b = byQ.get(key);
    b.count += 1;
    const rsd = paymentRsd(p);
    if (rsd == null) b.missing_rate += 1;
    else b.gross_rsd += rsd;
  }
  for (const b of byQ.values()) b.gross_rsd = Math.round(b.gross_rsd * 100) / 100;
  return [...byQ.values()].sort((a, b) => b.quarter.localeCompare(a.quarter));
}

/**
 * Unit price of an invoice line. New rows store `unit` in the invoice's own
 * currency; rows issued before multi-currency stored `unit_eur`.
 */
export const invoiceItemUnit = (item) => Number(item.unit ?? item.unit_eur) || 0;

/** Line amount for one invoice item: quantity × unit price. */
export function invoiceItemAmount(item) {
  return (Number(item.qty) || 0) * invoiceItemUnit(item);
}

/** Sum of all invoice line amounts. */
export function invoiceSubtotal(items) {
  return items.reduce((s, i) => s + invoiceItemAmount(i), 0);
}

/**
 * Invoice money totals in the invoice's currency. Line amounts are net (poreska osnovica).
 * `pdvRate` is a percentage (e.g. 20 or 10); pass 0 for a non-PDV issuer or an
 * exempt (foreign / izvoz usluga) invoice. Returns { subtotal, pdv, total }.
 */
export function invoiceTotals(items, pdvRate = 0) {
  const subtotal = invoiceSubtotal(items);
  const pdv = subtotal * ((Number(pdvRate) || 0) / 100);
  return { subtotal, pdv, total: subtotal + pdv };
}

/** Due date for payment terms: 'Net 7' / 'Net 14' add days; anything else is due on issue. */
export function dueDateFor(issuedOn, terms) {
  const m = /^Net (\d+)$/.exec(terms || '');
  return m ? addDays(issuedOn, Number(m[1])) : issuedOn;
}

/**
 * US ABA routing number check: 9 digits with the 3-7-1 weighted checksum.
 * Catches a mistyped digit before it's frozen onto an issued invoice.
 */
export function isValidAba(routing) {
  const s = String(routing || '').trim();
  if (!/^\d{9}$/.test(s)) return false;
  const d = s.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/**
 * Next per-year invoice number (YYYY-NNN) given the numbers already used.
 * Pass every number ever issued, void ones included — invoices are voided,
 * never deleted, so a number a client may already hold is never reused.
 */
export function nextInvoiceNumber(existingNumbers, year) {
  const prefix = `${year}-`;
  const maxSeq = existingNumbers
    .filter((n) => n.startsWith(prefix))
    .reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${year}-${String(maxSeq + 1).padStart(3, '0')}`;
}
