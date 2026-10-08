import { describe, it, expect } from 'vitest';
import {
  addMonths,
  advanceDueDate,
  daysBetween,
  chargeStatus,
  chargeMrr,
  overheadMonthly,
  paymentsRollup,
  yearlyRollup,
  projectRollup,
  invoiceItemAmount,
  invoiceSubtotal,
  invoiceTotals,
  nextInvoiceNumber,
  currenciesIn,
  businessToday,
  addDays,
  dueDateFor,
  isValidAba,
  paymentRsd,
  quarterlyRollup,
  invoiceState,
  balanceReminders,
  transferCost,
  transferCostRows,
  payoneerBalance,
} from './money.js';

describe('addMonths', () => {
  it('adds a month', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });
  it('rolls over the year', () => {
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
  });
  it('clamps day to end of shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('handles leap February', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });
  it('adds twelve months (yearly)', () => {
    expect(addMonths('2026-08-19', 12)).toBe('2027-08-19');
  });
});

describe('advanceDueDate', () => {
  it('monthly -> +1 month', () => {
    expect(advanceDueDate('2026-08-19', 'monthly')).toBe('2026-09-19');
  });
  it('yearly -> +12 months', () => {
    expect(advanceDueDate('2026-08-19', 'yearly')).toBe('2027-08-19');
  });
  it('one_time -> null', () => {
    expect(advanceDueDate('2026-08-19', 'one_time')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts forward days', () => {
    expect(daysBetween('2026-08-19', '2026-08-29')).toBe(10);
  });
  it('counts negative for past', () => {
    expect(daysBetween('2026-08-19', '2026-08-09')).toBe(-10);
  });
});

describe('chargeStatus', () => {
  const today = '2026-08-19';
  it('null due -> paid', () => {
    expect(chargeStatus(null, today)).toBe('paid');
  });
  it('past -> overdue', () => {
    expect(chargeStatus('2026-08-10', today)).toBe('overdue');
  });
  it('within 14 days -> due_soon', () => {
    expect(chargeStatus('2026-08-25', today)).toBe('due_soon');
  });
  it('far future -> upcoming', () => {
    expect(chargeStatus('2026-10-01', today)).toBe('upcoming');
  });
  it('exactly today -> due_soon', () => {
    expect(chargeStatus(today, today)).toBe('due_soon');
  });
});

describe('chargeMrr', () => {
  it('monthly income counts fully', () => {
    expect(chargeMrr({ direction: 'income', active: 1, frequency: 'monthly', amount: 50 })).toBe(50);
  });
  it('yearly income divided by 12', () => {
    expect(chargeMrr({ direction: 'income', active: 1, frequency: 'yearly', amount: 120 })).toBe(10);
  });
  it('one_time contributes nothing', () => {
    expect(chargeMrr({ direction: 'income', active: 1, frequency: 'one_time', amount: 2000 })).toBe(0);
  });
  it('inactive contributes nothing', () => {
    expect(chargeMrr({ direction: 'income', active: 0, frequency: 'monthly', amount: 50 })).toBe(0);
  });
  it('expense contributes nothing', () => {
    expect(chargeMrr({ direction: 'expense', active: 1, frequency: 'monthly', amount: 50 })).toBe(0);
  });
});

describe('overheadMonthly', () => {
  it('monthly cost counts fully', () => {
    expect(overheadMonthly({ active: 1, frequency: 'monthly', amount: 17 })).toBe(17);
  });
  it('yearly cost divided by 12', () => {
    expect(overheadMonthly({ active: 1, frequency: 'yearly', amount: 120 })).toBe(10);
  });
  it('one_time contributes nothing', () => {
    expect(overheadMonthly({ active: 1, frequency: 'one_time', amount: 300 })).toBe(0);
  });
  it('inactive contributes nothing', () => {
    expect(overheadMonthly({ active: 0, frequency: 'monthly', amount: 17 })).toBe(0);
  });
});

describe('paymentsRollup', () => {
  it('sums income and expenses into profit', () => {
    const r = paymentsRollup([
      { direction: 'income', amount: 2000 },
      { direction: 'income', amount: 50 },
      { direction: 'expense', amount: 30 },
    ]);
    expect(r).toEqual({ revenue: 2050, expenses: 30, profit: 2020 });
  });
  it('empty -> zeros', () => {
    expect(paymentsRollup([])).toEqual({ revenue: 0, expenses: 0, profit: 0 });
  });
});

describe('yearlyRollup', () => {
  it('groups realized payments by year, newest first', () => {
    const r = yearlyRollup([
      { direction: 'income', amount: 800, paid_on: '2026-03-01' },
      { direction: 'income', amount: 50, paid_on: '2026-04-01' },
      { direction: 'expense', amount: 20, paid_on: '2026-05-01' },
      { direction: 'income', amount: 500, paid_on: '2025-11-01' },
    ]);
    expect(r).toEqual([
      { year: '2026', revenue: 850, expenses: 20, profit: 830 },
      { year: '2025', revenue: 500, expenses: 0, profit: 500 },
    ]);
  });
  it('folds overhead payments into that year\'s expenses', () => {
    const r = yearlyRollup(
      [{ direction: 'income', amount: 100, paid_on: '2026-01-01' }],
      [{ amount: 17, paid_on: '2026-02-01' }, { amount: 5, paid_on: '2025-12-01' }],
    );
    expect(r).toEqual([
      { year: '2026', revenue: 100, expenses: 17, profit: 83 },
      { year: '2025', revenue: 0, expenses: 5, profit: -5 },
    ]);
  });
  it('empty -> empty array', () => {
    expect(yearlyRollup([])).toEqual([]);
  });
});

describe('invoice line math', () => {
  it('item amount = qty × unit', () => {
    expect(invoiceItemAmount({ qty: 12, unit_eur: 50 })).toBe(600);
    expect(invoiceItemAmount({ qty: 1, unit_eur: 800 })).toBe(800);
  });
  it('subtotal sums line amounts', () => {
    expect(invoiceSubtotal([{ qty: 1, unit_eur: 800 }, { qty: 12, unit_eur: 50 }])).toBe(1400);
  });
  it('tolerates missing/blank fields', () => {
    expect(invoiceItemAmount({})).toBe(0);
    expect(invoiceSubtotal([])).toBe(0);
  });
});

describe('invoiceTotals', () => {
  const items = [{ qty: 1, unit_eur: 800 }, { qty: 12, unit_eur: 50 }]; // subtotal 1400

  it('no rate -> pdv 0, total == subtotal (non-PDV issuer)', () => {
    expect(invoiceTotals(items)).toEqual({ subtotal: 1400, pdv: 0, total: 1400 });
    expect(invoiceTotals(items, 0)).toEqual({ subtotal: 1400, pdv: 0, total: 1400 });
  });
  it('20% rate -> osnovica + PDV = ukupno', () => {
    expect(invoiceTotals(items, 20)).toEqual({ subtotal: 1400, pdv: 280, total: 1680 });
  });
  it('lower 10% rate', () => {
    expect(invoiceTotals([{ qty: 1, unit_eur: 100 }], 10)).toEqual({ subtotal: 100, pdv: 10, total: 110 });
  });
  it('empty items -> all zero', () => {
    expect(invoiceTotals([], 20)).toEqual({ subtotal: 0, pdv: 0, total: 0 });
  });
});

describe('nextInvoiceNumber', () => {
  it('first of the year -> 001', () => {
    expect(nextInvoiceNumber([], '2026')).toBe('2026-001');
  });
  it('increments the max of that year only', () => {
    expect(nextInvoiceNumber(['2026-001', '2026-002', '2025-009'], '2026')).toBe('2026-003');
  });
  it('resets per year', () => {
    expect(nextInvoiceNumber(['2025-004'], '2026')).toBe('2026-001');
  });
});

describe('projectRollup', () => {
  it('combines realized payments with MRR from charges', () => {
    const charges = [
      { direction: 'income', active: 1, frequency: 'monthly', amount: 50 },
      { direction: 'income', active: 1, frequency: 'yearly', amount: 120 },
    ];
    const payments = [{ direction: 'income', amount: 2000 }];
    const r = projectRollup(charges, payments);
    expect(r.revenue).toBe(2000);
    expect(r.mrr).toBe(60); // 50 + 120/12
    expect(r.profit).toBe(2000);
  });
});

describe('multi-currency rollups', () => {
  const payments = [
    { direction: 'income', amount: 800 },                    // legacy row → EUR
    { direction: 'income', amount: 1200, currency: 'USD', fee: 12 },
    { direction: 'expense', amount: 30, currency: 'EUR' },
  ];
  it('never adds currencies together', () => {
    expect(paymentsRollup(payments)).toEqual({ revenue: 800, expenses: 30, profit: 770 });
    expect(paymentsRollup(payments, 'USD')).toEqual({ revenue: 1200, expenses: 12, profit: 1188 });
  });
  it('yearlyRollup filters by currency', () => {
    const dated = payments.map((p) => ({ ...p, paid_on: '2026-09-06' }));
    expect(yearlyRollup(dated, [{ amount: 20, currency: 'USD', paid_on: '2026-09-01' }], 'USD'))
      .toEqual([{ year: '2026', revenue: 1200, expenses: 32, profit: 1168 }]);
  });
  it('projectRollup MRR only counts charges in that currency', () => {
    const charges = [
      { direction: 'income', active: 1, frequency: 'monthly', amount: 50 },
      { direction: 'income', active: 1, frequency: 'monthly', amount: 99, currency: 'USD' },
    ];
    expect(projectRollup(charges, [], 'USD').mrr).toBe(99);
    expect(projectRollup(charges, []).mrr).toBe(50);
  });
  it('currenciesIn lists present currencies in a stable order', () => {
    expect(currenciesIn(payments, [{ currency: 'RSD' }])).toEqual(['EUR', 'USD', 'RSD']);
    expect(currenciesIn([])).toEqual([]);
  });
});

describe('businessToday', () => {
  it('returns the Belgrade date at 00:30 local in summer (UTC+2)', () => {
    expect(businessToday(new Date('2026-09-05T22:30:00Z'))).toBe('2026-09-06');
  });
  it('returns the Belgrade date at 00:30 local in winter (UTC+1)', () => {
    expect(businessToday(new Date('2026-01-05T23:30:00Z'))).toBe('2026-01-06');
  });
  it('matches UTC during the day', () => {
    expect(businessToday(new Date('2026-09-06T12:00:00Z'))).toBe('2026-09-06');
  });
});

describe('due dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
  });
  it('maps payment terms to a due date', () => {
    expect(dueDateFor('2026-09-06', 'Due on receipt')).toBe('2026-09-06');
    expect(dueDateFor('2026-09-06', 'Net 7')).toBe('2026-09-13');
    expect(dueDateFor('2026-09-06', 'Net 14')).toBe('2026-09-20');
    expect(dueDateFor('2026-09-06', '')).toBe('2026-09-06');
  });
});

describe('isValidAba', () => {
  it('accepts a 9-digit number with a valid checksum', () => {
    expect(isValidAba('123456780')).toBe(true); // fake, checksum-valid
  });
  it('rejects a single mistyped digit, wrong length or non-digits', () => {
    expect(isValidAba('123456789')).toBe(false);
    expect(isValidAba('12345678')).toBe(false);
    expect(isValidAba('12345678a')).toBe(false);
    expect(isValidAba('')).toBe(false);
  });
});

describe('voided invoice numbers', () => {
  it('a voided invoice keeps its number, so the next one never reuses it', () => {
    // 2026-002 was voided — the row (and its number) stays in the table.
    const rows = [
      { number: '2026-001', status: 'issued' },
      { number: '2026-002', status: 'void' },
    ];
    expect(nextInvoiceNumber(rows.map((r) => r.number), '2026')).toBe('2026-003');
  });
});

describe('paymentRsd', () => {
  it('uses the snapshotted amount_rsd, else amount × its own NBS rate', () => {
    expect(paymentRsd({ amount: 100, currency: 'USD', amount_rsd: 10050 })).toBe(10050);
    expect(paymentRsd({ amount: 100, currency: 'USD', nbs_rate_rsd: 100.5 })).toBe(10050);
  });
  it('RSD payments need no rate; others without a rate are unknown', () => {
    expect(paymentRsd({ amount: 5000, currency: 'RSD' })).toBe(5000);
    expect(paymentRsd({ amount: 100, currency: 'USD' })).toBeNull();
  });
});

describe('quarterlyRollup', () => {
  const p = (paid_on, extra = {}) => ({
    direction: 'income', amount: 1000, currency: 'USD', nbs_rate_rsd: 100,
    channel: 'payoneer_receiving_ach', paid_on, ...extra,
  });
  it('puts payments in the right calendar quarter, newest first', () => {
    const r = quarterlyRollup([p('2026-03-31'), p('2026-04-01'), p('2026-06-30'), p('2026-10-01')]);
    expect(r).toEqual([
      { quarter: '2026-Q4', gross_rsd: 100000, count: 1, missing_rate: 0 },
      { quarter: '2026-Q2', gross_rsd: 200000, count: 2, missing_rate: 0 },
      { quarter: '2026-Q1', gross_rsd: 100000, count: 1, missing_rate: 0 },
    ]);
  });
  it('excludes domestic, legacy (no channel) and expense rows', () => {
    const r = quarterlyRollup([
      p('2026-09-01'),
      p('2026-09-02', { channel: 'domestic' }),
      p('2026-09-03', { channel: null }),
      p('2026-09-04', { direction: 'expense' }),
    ]);
    expect(r).toEqual([{ quarter: '2026-Q3', gross_rsd: 100000, count: 1, missing_rate: 0 }]);
  });
  it('can bucket by the Payoneer-credited date instead', () => {
    const rows = [p('2026-06-30', { received_on: '2026-07-02' })];
    expect(quarterlyRollup(rows)[0].quarter).toBe('2026-Q2');
    expect(quarterlyRollup(rows, 'received_on')[0].quarter).toBe('2026-Q3');
    expect(quarterlyRollup([p('2026-06-30')], 'received_on')[0].quarter).toBe('2026-Q2'); // falls back
  });
  it('flags payments still missing an NBS rate instead of guessing', () => {
    const r = quarterlyRollup([p('2026-09-01'), p('2026-09-02', { nbs_rate_rsd: null })]);
    expect(r[0]).toEqual({ quarter: '2026-Q3', gross_rsd: 100000, count: 2, missing_rate: 1 });
  });
});

describe('invoice line math (new rows)', () => {
  it('reads `unit` on new rows and `unit_eur` on old ones', () => {
    expect(invoiceItemAmount({ qty: 2, unit: 600 })).toBe(1200);
    expect(invoiceItemAmount({ qty: 2, unit_eur: 600 })).toBe(1200);
  });
});

describe('invoiceState', () => {
  const inv = { id: 7, number: '2026-007', tracked: 1, status: 'issued', doc_currency: 'USD', total: 1200, due_on: '2026-09-13' };
  const pay = (amount, extra = {}) => ({ invoice_id: 7, direction: 'income', currency: 'USD', amount, ...extra });

  it('unpaid before the due date, overdue after it', () => {
    expect(invoiceState(inv, [], '2026-09-13').state).toBe('unpaid');
    expect(invoiceState(inv, [], '2026-09-14')).toEqual({ state: 'overdue', total: 1200, paid: 0, remaining: 1200 });
  });
  it('partial, then paid once linked payments cover the total', () => {
    expect(invoiceState(inv, [pay(500)], '2026-09-10')).toEqual({ state: 'partial', total: 1200, paid: 500, remaining: 700 });
    expect(invoiceState(inv, [pay(500), pay(700)], '2026-09-20').state).toBe('paid');
  });
  it('ignores payments for other invoices or in another currency', () => {
    expect(invoiceState(inv, [pay(1200, { invoice_id: 8 }), pay(1200, { currency: 'EUR' })], '2026-09-10').state).toBe('unpaid');
  });
  it('void and pre-tracking invoices are never outstanding', () => {
    expect(invoiceState({ ...inv, status: 'void' }, [], '2026-12-01').state).toBe('void');
    expect(invoiceState({ ...inv, tracked: 0 }, [], '2026-12-01').state).toBe('untracked');
  });
  it('old EUR rows fall back to total_eur', () => {
    expect(invoiceState({ id: 1, tracked: 1, total_eur: 800 }, [], '2026-01-01').total).toBe(800);
  });
});

describe('balanceReminders', () => {
  const dep = { id: 1, number: '2026-001', stage: 'deposit', tracked: 1, doc_currency: 'USD', total: 600 };
  const paid = [{ invoice_id: 1, direction: 'income', currency: 'USD', amount: 600 }];
  it('flags a paid deposit with no balance invoice yet', () => {
    expect(balanceReminders([dep], paid, '2026-09-10').map((i) => i.number)).toEqual(['2026-001']);
  });
  it('clears once a balance invoice references it, unless that one is void', () => {
    const bal = { id: 2, number: '2026-002', stage: 'balance', deposit_ref: '2026-001', status: 'issued' };
    expect(balanceReminders([dep, bal], paid, '2026-09-10')).toEqual([]);
    expect(balanceReminders([dep, { ...bal, status: 'void' }], paid, '2026-09-10')).toHaveLength(1);
  });
  it('waits until the deposit is actually paid', () => {
    expect(balanceReminders([dep], [], '2026-09-10')).toEqual([]);
  });
});

describe('transfers', () => {
  // $1,000 out, €850 in; NBS: 1 USD = 104 RSD, 1 EUR = 117 RSD.
  // €850 is worth 850 × 117 / 104 = $956.25 → conversion cost $43.75.
  const t = { transferred_on: '2026-10-05', out_amount: 1000, out_currency: 'USD', in_amount: 850, in_currency: 'EUR', nbs_out_rsd: 104, nbs_in_rsd: 117 };

  it('costs the conversion at NBS middle rates, in the outgoing currency', () => {
    expect(transferCost(t)).toBe(43.75);
  });
  it('is unknown until both rates are in', () => {
    expect(transferCost({ ...t, nbs_in_rsd: null })).toBeNull();
  });
  it('feeds rollups as an expense in the outgoing currency, not revenue', () => {
    expect(transferCostRows([t, { ...t, nbs_out_rsd: null }])).toEqual([{ amount: 43.75, currency: 'USD', paid_on: '2026-10-05' }]);
    expect(yearlyRollup([], transferCostRows([t]), 'USD')).toEqual([{ year: '2026', revenue: 0, expenses: 43.75, profit: -43.75 }]);
  });
  it('tracks what is still held in Payoneer', () => {
    const payments = [
      { direction: 'income', currency: 'USD', amount: 1200, fee: 12, channel: 'payoneer_receiving_ach' },
      { direction: 'income', currency: 'USD', amount: 300, channel: 'payoneer_request_card' },
      { direction: 'income', currency: 'EUR', amount: 800, channel: 'domestic' },
    ];
    expect(payoneerBalance(payments, [t])).toEqual({ USD: 488 });
  });
});
