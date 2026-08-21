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
  nextInvoiceNumber,
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
