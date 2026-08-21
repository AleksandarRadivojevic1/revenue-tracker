// Pure money/date logic. No I/O — unit-tested in money.test.js.

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
 * Roll up realized totals for a set of payments (actual money that moved).
 * Returns { revenue, expenses, profit }.
 */
export function paymentsRollup(payments) {
  let revenue = 0;
  let expenses = 0;
  for (const p of payments) {
    if (p.direction === 'income') revenue += p.amount;
    else if (p.direction === 'expense') expenses += p.amount;
  }
  return { revenue, expenses, profit: revenue - expenses };
}

/**
 * Realized totals grouped by calendar year (from paid_on). Project payments
 * split by direction; overhead payments are all expenses. Returns an array of
 * { year, revenue, expenses, profit }, newest year first.
 */
export function yearlyRollup(payments, overheadPayments = []) {
  const byYear = new Map();
  const bucket = (year) => {
    if (!byYear.has(year)) byYear.set(year, { year, revenue: 0, expenses: 0, profit: 0 });
    return byYear.get(year);
  };
  for (const p of payments) {
    const b = bucket(p.paid_on.slice(0, 4));
    if (p.direction === 'income') b.revenue += p.amount;
    else if (p.direction === 'expense') b.expenses += p.amount;
  }
  for (const p of overheadPayments) {
    bucket(p.paid_on.slice(0, 4)).expenses += p.amount;
  }
  for (const b of byYear.values()) b.profit = b.revenue - b.expenses;
  return [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/** Per-project rollup: realized totals from payments + MRR from active charges. */
export function projectRollup(charges, payments) {
  const base = paymentsRollup(payments);
  const mrr = charges.reduce((s, c) => s + chargeMrr(c), 0);
  return { ...base, mrr };
}

/** Dashboard-wide rollup across everything. */
export function dashboardRollup(charges, payments) {
  return projectRollup(charges, payments);
}

/** Line amount for one invoice item: quantity × unit price (EUR). */
export function invoiceItemAmount(item) {
  return (Number(item.qty) || 0) * (Number(item.unit_eur) || 0);
}

/** Sum of all invoice line amounts (EUR). */
export function invoiceSubtotal(items) {
  return items.reduce((s, i) => s + invoiceItemAmount(i), 0);
}

/**
 * Invoice money totals in EUR. Line amounts are net (poreska osnovica).
 * `pdvRate` is a percentage (e.g. 20 or 10); pass 0 for a non-PDV issuer or an
 * exempt (foreign / izvoz usluga) invoice. Returns { subtotal, pdv, total }.
 */
export function invoiceTotals(items, pdvRate = 0) {
  const subtotal = invoiceSubtotal(items);
  const pdv = subtotal * ((Number(pdvRate) || 0) / 100);
  return { subtotal, pdv, total: subtotal + pdv };
}

/** Next per-year invoice number (YYYY-NNN) given the numbers already used. */
export function nextInvoiceNumber(existingNumbers, year) {
  const prefix = `${year}-`;
  const maxSeq = existingNumbers
    .filter((n) => n.startsWith(prefix))
    .reduce((m, n) => Math.max(m, Number(n.slice(prefix.length)) || 0), 0);
  return `${year}-${String(maxSeq + 1).padStart(3, '0')}`;
}
