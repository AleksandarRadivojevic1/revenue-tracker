import { useMemo, useState } from 'react';
import {
  balanceReminders, chargeRemaining, chargeStatus, chargeMrr, currencyOf, invoiceState, overheadMonthly, paymentsRollup, payoneerBalance,
  perCurrency, quarterlyRollup, transferCost, transferCostRows, yearlyRollup,
} from '../../server/money.js';
import { formatMoney, formatAmounts, formatDate, FREQUENCY_LABEL, INVOICE_STATE_META } from '../format.js';
import { packageMeta, OVERHEAD_CATEGORIES } from '../catalog.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import OverheadForm from '../components/OverheadForm.jsx';
import TransferForm from '../components/TransferForm.jsx';
import { InvoiceForm, invoicedPeriods } from './Invoices.jsx';
import useMediaQuery from '../hooks/useMediaQuery.js';

const OVERHEAD_LABEL = Object.fromEntries(OVERHEAD_CATEGORIES.map((c) => [c.key, c.label]));

export default function Dashboard({
  data, onOpenProject, onOpenInvoices, createProject, payCharge, createInvoice,
  createOverhead, updateOverhead, deleteOverhead, payOverhead, saveTransfer, deleteTransfer,
}) {
  const { projects, charges, payments, overheads, overhead_payments, invoices = [], transfers = [], settings, today } = data;
  // Overhead spend plus Payoneer conversion costs — both realized expenses.
  const costRows = useMemo(() => [...overhead_payments, ...transferCostRows(transfers)], [overhead_payments, transfers]);
  const [showNew, setShowNew] = useState(false);
  const [overheadModal, setOverheadModal] = useState(null); // { initial? } | null
  const [payingKey, setPayingKey] = useState(null);
  const [invoicing, setInvoicing] = useState(null); // charge row to invoice
  const [transferModal, setTransferModal] = useState(null); // { initial? } | null
  const [showArchived, setShowArchived] = useState(false);
  const compact = useMediaQuery('(max-width: 560px)');

  // KPIs per currency — EUR and USD are never added together. Each currency
  // shows in its own unit; the EUR ⇄ RSD toggle only converts EUR.
  const totals = useMemo(() => {
    const only = (rows, c) => rows.filter((r) => currencyOf(r) === c);
    return perCurrency([charges, payments, overheads, costRows], (c) => {
      const { revenue, expenses: projectExpenses } = paymentsRollup(payments, c);
      const overheadSpend = only(costRows, c).reduce((s, p) => s + p.amount, 0);
      const expenses = projectExpenses + overheadSpend;
      const mrr = only(charges, c).reduce((s, x) => s + chargeMrr(x), 0);
      const recurringCosts = only(overheads, c).reduce((s, o) => s + overheadMonthly(o), 0);
      return { revenue, expenses, profit: revenue - expenses, mrr, recurringCosts };
    });
  }, [charges, payments, overheads, costRows]);
  const fmtTotal = (k) => formatAmounts(totals, settings, (t) => t[k]);
  const profitPositive = Object.values(totals).every((t) => t.profit >= 0);

  const byProject = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, { charges: [], payments: [] }]));
    charges.forEach((c) => m.get(c.project_id)?.charges.push(c));
    payments.forEach((p) => m.get(p.project_id)?.payments.push(p));
    return m;
  }, [projects, charges, payments]);

  // Archived projects stay in every total; they're only hidden from the grid.
  const archivedCount = projects.filter((p) => p.status === 'archived').length;
  const visibleProjects = showArchived ? projects : projects.filter((p) => p.status !== 'archived');

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';

  // Charges and overheads that are due soon or overdue, merged into one list.
  const scheduled = useMemo(() => {
    const fromCharges = charges
      .filter((c) => c.active && c.next_due)
      .map((c) => ({
        kind: 'charge', id: c.id, source: projectName(c.project_id), projectId: c.project_id, charge: c,
        // What's left on this period — less than the charge once part-paid.
        label: c.label || c.category, frequency: c.frequency, next_due: c.next_due,
        amount: chargeRemaining(c, payments), currency: currencyOf(c),
        status: chargeStatus(c.next_due, today),
      }));
    const fromOverheads = overheads
      .filter((o) => o.active && o.next_due)
      .map((o) => ({
        kind: 'overhead', id: o.id, source: 'Overhead',
        label: o.label, frequency: o.frequency, next_due: o.next_due, amount: o.amount, currency: currencyOf(o),
        status: chargeStatus(o.next_due, today),
      }));
    return [...fromCharges, ...fromOverheads]
      .filter((r) => r.status === 'overdue' || r.status === 'due_soon')
      .sort((a, b) => a.next_due.localeCompare(b.next_due));
  }, [charges, overheads, payments, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // One row per year and currency, newest year first.
  const invoiced = useMemo(() => invoicedPeriods(invoices), [invoices]);
  // Income charge rows get an Invoice action, or the number already issued for this period.
  function invoiceAction(r) {
    if (r.kind !== 'charge' || r.charge.direction !== 'income') return null;
    const number = invoiced.get(`${r.id}:${r.next_due}`);
    if (number) return <span className="muted" style={{ fontSize: 12 }}>Invoiced {number}</span>;
    return <button className="btn btn-sm btn-ghost" onClick={() => setInvoicing(r.charge)}>Invoice</button>;
  }

  const yearly = useMemo(() => {
    const byCur = perCurrency([payments, costRows], (c) => yearlyRollup(payments, costRows, c));
    return Object.entries(byCur)
      .flatMap(([currency, rows]) => rows.map((r) => ({ ...r, currency })))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [payments, costRows]);
  const multiCurrency = new Set(yearly.map((y) => y.currency)).size > 1;

  // Invoices still owed (oldest due first) and paid deposits awaiting a balance invoice.
  const outstanding = useMemo(() => invoices
    .map((inv) => ({ inv, st: invoiceState(inv, payments, today) }))
    .filter(({ st }) => ['unpaid', 'partial', 'overdue'].includes(st.state))
    .sort((a, b) => (a.inv.due_on || '').localeCompare(b.inv.due_on || '')),
  [invoices, payments, today]);
  const awaitingBalance = useMemo(() => balanceReminders(invoices, payments, today), [invoices, payments, today]);
  const buyerName = (inv) => { try { return JSON.parse(inv.buyer_json).name; } catch { return '—'; } };
  const docFmt = (n, inv) => formatMoney(n, inv.doc_currency || 'EUR', (inv.doc_currency || 'EUR') === 'EUR' ? settings : undefined);

  const heldInPayoneer = useMemo(() => payoneerBalance(payments, transfers), [payments, transfers]);
  const showPayoneer = transfers.length > 0 || Object.keys(heldInPayoneer).length > 0;

  const taxBasis = settings.tax_date_basis || 'paid_on';
  const quarters = useMemo(() => quarterlyRollup(payments, taxBasis), [payments, taxBasis]);

  const activeOverheads = useMemo(
    () => overheads.filter((o) => o.active).sort((a, b) => (a.next_due || '').localeCompare(b.next_due || '')),
    [overheads]
  );

  async function handlePay(row) {
    const key = `${row.kind}:${row.id}`;
    setPayingKey(key);
    try {
      if (row.kind === 'overhead') await payOverhead(row.id);
      else await payCharge(row.id);
    } finally { setPayingKey(null); }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{projects.length} project{projects.length === 1 ? '' : 's'} · realized totals per currency · EUR shown in {settings.display_currency}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New project</button>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="label">Total revenue</div>
          <div className="value blue">{fmtTotal('revenue')}</div>
          <div className="hint">Paid income, all time</div>
        </div>
        <div className="kpi">
          <div className="label">Total expenses</div>
          <div className="value">{fmtTotal('expenses')}</div>
          <div className="hint">What I've spent, incl. overhead &amp; fees</div>
        </div>
        <div className="kpi">
          <div className="label">Net profit</div>
          <div className={`value ${profitPositive ? 'pos' : 'neg'}`}>{fmtTotal('profit')}</div>
          <div className="hint">Revenue − expenses</div>
        </div>
        <div className="kpi">
          <div className="label">Recurring / mo (MRR)</div>
          <div className="value">{fmtTotal('mrr')}</div>
          <div className="hint">Active maintenance + monthly</div>
        </div>
        <div className="kpi">
          <div className="label">Recurring costs / mo</div>
          <div className="value">{fmtTotal('recurringCosts')}</div>
          <div className="hint">Subscriptions &amp; tools</div>
        </div>
      </div>

      {(outstanding.length > 0 || awaitingBalance.length > 0) && (
        <>
          <h2 className="section-title">Outstanding invoices</h2>
          <div className="card" style={{ padding: 0 }}>
            <div className="overhead-list">
              {outstanding.map(({ inv, st }) => (
                <div className="overhead-row" key={inv.id}>
                  <div className="oh-main">
                    <div className="oh-label">{inv.number} · {buyerName(inv)}</div>
                    <div className="oh-sub">
                      {inv.due_on ? <>Due {formatDate(inv.due_on)} · </> : null}
                      <span className={`pill ${INVOICE_STATE_META[st.state].tone}`}><span className="dot" />{INVOICE_STATE_META[st.state].label}</span>
                    </div>
                  </div>
                  <div className="oh-amount num">{docFmt(st.remaining, inv)}</div>
                  <div className="oh-actions">
                    <button className="btn btn-sm" onClick={onOpenInvoices}>Open</button>
                  </div>
                </div>
              ))}
              {awaitingBalance.map((inv) => (
                <div className="overhead-row" key={`bal:${inv.id}`}>
                  <div className="oh-main">
                    <div className="oh-label">Send the balance invoice · {buyerName(inv)}</div>
                    <div className="oh-sub">Deposit {inv.number} is paid — work can start; bill the balance on delivery.</div>
                  </div>
                  <div className="oh-amount num" />
                  <div className="oh-actions">
                    <button className="btn btn-sm" onClick={onOpenInvoices}>Invoices</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <h2 className="section-title">Scheduled — due soon &amp; overdue</h2>
      <div className="card" style={{ padding: 0 }}>
        {scheduled.length === 0 ? (
          <div className="empty">Nothing due right now. 🎉</div>
        ) : compact ? (
          <div className="sched-cards">
            {scheduled.map((r) => (
              <div className="sched-card" key={`${r.kind}:${r.id}`}>
                <div className="sched-card-top">
                  {r.kind === 'charge'
                    ? <a onClick={() => onOpenProject(r.projectId)} style={{ cursor: 'pointer' }}>{r.source}</a>
                    : <span className="muted">Overhead</span>}
                  <span className="num" style={{ fontWeight: 600 }}>{formatMoney(r.amount, r.currency, settings)}</span>
                </div>
                <div className="sched-card-sub">{r.label} · {FREQUENCY_LABEL[r.frequency]} · Due {formatDate(r.next_due)}</div>
                <div className="sched-card-foot">
                  <StatusBadge status={r.status} />
                  {invoiceAction(r)}
                  <button className="btn btn-sm" disabled={payingKey === `${r.kind}:${r.id}`} onClick={() => handlePay(r)}>
                    {payingKey === `${r.kind}:${r.id}` ? '…' : 'Mark paid'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th><th>Charge</th><th>Next due</th><th>Status</th>
                <th className="num">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map((r) => (
                <tr key={`${r.kind}:${r.id}`}>
                  <td>
                    {r.kind === 'charge'
                      ? <a onClick={() => onOpenProject(r.projectId)} style={{ cursor: 'pointer' }}>{r.source}</a>
                      : <span className="muted">Overhead</span>}
                  </td>
                  <td>{r.label} <span className="muted">{FREQUENCY_LABEL[r.frequency]}</span></td>
                  <td>{formatDate(r.next_due)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num">{formatMoney(r.amount, r.currency, settings)}</td>
                  <td className="num">
                    <div className="row-actions">
                      {invoiceAction(r)}
                      <button className="btn btn-sm" disabled={payingKey === `${r.kind}:${r.id}`} onClick={() => handlePay(r)}>
                        {payingKey === `${r.kind}:${r.id}` ? '…' : 'Mark paid'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 12px' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Overhead — subscriptions &amp; tools</h2>
        <button className="btn btn-sm" onClick={() => setOverheadModal({})}>+ Add cost</button>
      </div>
      <div className="card" style={{ padding: activeOverheads.length === 0 ? 16 : 0 }}>
        {activeOverheads.length === 0 ? (
          <div className="empty">No overhead costs yet. Add Claude Code, hosting, domains…</div>
        ) : (
          <div className="overhead-list">
            {activeOverheads.map((o) => (
              <div className="overhead-row" key={o.id}>
                <div className="oh-main">
                  <div className="oh-label">{o.label} <span className="muted">{FREQUENCY_LABEL[o.frequency]}</span></div>
                  <div className="oh-sub">
                    {OVERHEAD_LABEL[o.category] || o.category}
                    {o.next_due ? <> · Due {formatDate(o.next_due)}</> : null}
                    {o.next_due && (o.frequency !== 'one_time' || chargeStatus(o.next_due, today) !== 'upcoming') && (
                      <> · <StatusBadge status={chargeStatus(o.next_due, today)} /></>
                    )}
                  </div>
                </div>
                <div className="oh-amount num">{formatMoney(o.amount, currencyOf(o), settings)}</div>
                <div className="oh-actions">
                  <button className="btn btn-sm" disabled={payingKey === `overhead:${o.id}`} onClick={() => handlePay({ kind: 'overhead', id: o.id })}>
                    {payingKey === `overhead:${o.id}` ? '…' : 'Mark paid'}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setOverheadModal({ initial: o })}>Edit</button>
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (confirm(`Delete "${o.label}"? Past payments stay in your totals.`)) deleteOverhead(o.id); }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showPayoneer && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 12px' }}>
            <h2 className="section-title" style={{ margin: 0 }}>Payoneer → bank</h2>
            <button className="btn btn-sm" onClick={() => setTransferModal({})}>+ Log transfer</button>
          </div>
          <div className="card" style={{ padding: 0 }}>
            <div className="kv" style={{ padding: '12px 16px', margin: 0 }}>
              <span className="k">Held in Payoneer (received − fees − transferred)</span>
              <span className="v blue">{formatAmounts(heldInPayoneer, settings)}</span>
            </div>
            {transfers.length > 0 && (
              <div className="overhead-list">
                {transfers.map((t) => {
                  const cost = transferCost(t);
                  return (
                    <div className="overhead-row" key={t.id}>
                      <div className="oh-main">
                        <div className="oh-label">
                          {formatMoney(t.out_amount, t.out_currency)} → {formatMoney(t.in_amount, t.in_currency)}
                        </div>
                        <div className="oh-sub">
                          {formatDate(t.transferred_on)} · 1 {t.out_currency} = {(t.in_amount / t.out_amount).toFixed(4)} {t.in_currency}
                          {t.note ? <> · {t.note}</> : null}
                        </div>
                      </div>
                      <div className="oh-amount num" title="Fees + FX spread vs NBS middle rates">
                        {cost == null ? <span className="muted">cost pending</span> : <>−{formatMoney(cost, t.out_currency)}</>}
                      </div>
                      <div className="oh-actions">
                        <button className="btn btn-sm btn-ghost" onClick={() => setTransferModal({ initial: t })}>Edit</button>
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (confirm('Delete this transfer?')) deleteTransfer(t.id); }}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="inline-note">Cost = what left Payoneer minus what arrived, both valued at the NBS middle rates of the day. Counted as an expense.</p>
        </>
      )}

      <h2 className="section-title">By year</h2>
      <div className="card" style={{ padding: 0 }}>
        {yearly.length === 0 ? (
          <div className="empty">No payments logged yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Revenue</th>
                <th className="num">Expenses</th>
                <th className="num">Profit</th>
              </tr>
            </thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={`${y.year}:${y.currency}`}>
                  <td style={{ fontWeight: 500 }}>{y.year}{multiCurrency && <span className="muted"> · {y.currency}</span>}</td>
                  <td className="num" style={{ color: 'var(--color-electric-blue)' }}>{formatMoney(y.revenue, y.currency, settings)}</td>
                  <td className="num">{formatMoney(y.expenses, y.currency, settings)}</td>
                  <td className="num" style={{ color: y.profit >= 0 ? 'var(--color-vivid-green)' : 'var(--color-tangerine)' }}>{formatMoney(y.profit, y.currency, settings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="section-title">Freelancer tax base by quarter</h2>
      <div className="card" style={{ padding: 0 }}>
        {quarters.length === 0 ? (
          <div className="empty">No foreign income logged yet. Payments with a Payoneer channel show up here.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th className="num">Payments</th>
                <th className="num">Gross (RSD)</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((q) => (
                <tr key={q.quarter}>
                  <td style={{ fontWeight: 500 }}>{q.quarter.replace('-', ' ')}</td>
                  <td className="num">
                    {q.count}
                    {q.missing_rate > 0 && <span style={{ color: 'var(--color-tangerine)' }}> · {q.missing_rate} missing NBS rate</span>}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{formatMoney(q.gross_rsd, 'RSD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="inline-note">
        Gross foreign income × each payment's own NBS rate, bucketed by {taxBasis === 'received_on' ? 'the date credited in Payoneer' : 'the paid-on date'} (change in Settings).
        Domestic payments are excluded. Confirm the date rule and gross basis with your accountant before filing.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 12px' }}>
        <h2 className="section-title" style={{ margin: 0 }}>Projects</h2>
        {archivedCount > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        )}
      </div>
      {projects.length === 0 ? (
        <div className="card"><div className="empty">No projects yet. Create your first one.</div></div>
      ) : (
        <div className="grid">
          {visibleProjects.map((p) => {
            const bucket = byProject.get(p.id) || { charges: [], payments: [] };
            const roll = perCurrency([bucket.payments], (c) => paymentsRollup(bucket.payments, c));
            const pkg = packageMeta(p.package);
            return (
              <div key={p.id} className="card project-card" onClick={() => onOpenProject(p.id)}>
                <div className="top">
                  <div>
                    <h3>{p.name}</h3>
                    <div className="client">{p.client || 'No client'}</div>
                  </div>
                  {pkg && <span className={`pill accent-${pkg.accent}`}><span className="dot" />{pkg.name}</span>}
                </div>
                <div className="metrics">
                  <div className="metric">
                    <div className="m-label">Revenue</div>
                    <div className="m-value">{formatAmounts(roll, settings, (r) => r.revenue)}</div>
                  </div>
                  <div className="metric">
                    <div className="m-label">Profit</div>
                    <div className="m-value">{formatAmounts(roll, settings, (r) => r.profit)}</div>
                  </div>
                  <div className="metric">
                    <div className="m-label">Status</div>
                    <div className="m-value" style={{ textTransform: 'capitalize' }}>{p.status}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <ProjectForm settings={settings} onSubmit={createProject} onClose={() => setShowNew(false)} />
      )}
      {transferModal && (
        <TransferForm initial={transferModal.initial}
          onSubmit={(d) => saveTransfer(transferModal.initial?.id, d)} onClose={() => setTransferModal(null)} />
      )}
      {invoicing && (
        <InvoiceForm projects={projects} charges={charges} invoices={invoices} settings={settings}
          forCharge={invoicing} onSubmit={createInvoice} onClose={() => setInvoicing(null)} />
      )}
      {overheadModal && (
        <OverheadForm
          initial={overheadModal.initial}
          onSubmit={(d) => overheadModal.initial ? updateOverhead(overheadModal.initial.id, d) : createOverhead(d)}
          onClose={() => setOverheadModal(null)}
        />
      )}
    </main>
  );
}
