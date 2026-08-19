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
