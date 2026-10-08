import { useMemo, useState } from 'react';
import {
  chargeStatus, chargeMrr, currencyOf, overheadMonthly, paymentsRollup, perCurrency, quarterlyRollup, yearlyRollup,
} from '../../server/money.js';
import { formatMoney, formatAmounts, formatDate, FREQUENCY_LABEL } from '../format.js';
import { packageMeta, OVERHEAD_CATEGORIES } from '../catalog.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import OverheadForm from '../components/OverheadForm.jsx';
import useMediaQuery from '../hooks/useMediaQuery.js';

const OVERHEAD_LABEL = Object.fromEntries(OVERHEAD_CATEGORIES.map((c) => [c.key, c.label]));

export default function Dashboard({
  data, onOpenProject, createProject, payCharge,
  createOverhead, updateOverhead, deleteOverhead, payOverhead,
}) {
  const { projects, charges, payments, overheads, overhead_payments, settings, today } = data;
  const [showNew, setShowNew] = useState(false);
  const [overheadModal, setOverheadModal] = useState(null); // { initial? } | null
  const [payingKey, setPayingKey] = useState(null);
  const compact = useMediaQuery('(max-width: 560px)');

  // KPIs per currency — EUR and USD are never added together. Each currency
  // shows in its own unit; the EUR ⇄ RSD toggle only converts EUR.
  const totals = useMemo(() => {
    const only = (rows, c) => rows.filter((r) => currencyOf(r) === c);
    return perCurrency([charges, payments, overheads, overhead_payments], (c) => {
      const { revenue, expenses: projectExpenses } = paymentsRollup(payments, c);
      const overheadSpend = only(overhead_payments, c).reduce((s, p) => s + p.amount, 0);
      const expenses = projectExpenses + overheadSpend;
      const mrr = only(charges, c).reduce((s, x) => s + chargeMrr(x), 0);
      const recurringCosts = only(overheads, c).reduce((s, o) => s + overheadMonthly(o), 0);
      return { revenue, expenses, profit: revenue - expenses, mrr, recurringCosts };
    });
  }, [charges, payments, overheads, overhead_payments]);
  const fmtTotal = (k) => formatAmounts(totals, settings, (t) => t[k]);
  const profitPositive = Object.values(totals).every((t) => t.profit >= 0);

  const byProject = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, { charges: [], payments: [] }]));
    charges.forEach((c) => m.get(c.project_id)?.charges.push(c));
    payments.forEach((p) => m.get(p.project_id)?.payments.push(p));
    return m;
  }, [projects, charges, payments]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';

  // Charges and overheads that are due soon or overdue, merged into one list.
  const scheduled = useMemo(() => {
    const fromCharges = charges
      .filter((c) => c.active && c.next_due)
      .map((c) => ({
        kind: 'charge', id: c.id, source: projectName(c.project_id), projectId: c.project_id,
        label: c.label || c.category, frequency: c.frequency, next_due: c.next_due, amount: c.amount, currency: currencyOf(c),
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
  }, [charges, overheads, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // One row per year and currency, newest year first.
  const yearly = useMemo(() => {
    const byCur = perCurrency([payments, overhead_payments], (c) => yearlyRollup(payments, overhead_payments, c));
    return Object.entries(byCur)
      .flatMap(([currency, rows]) => rows.map((r) => ({ ...r, currency })))
      .sort((a, b) => b.year.localeCompare(a.year));
  }, [payments, overhead_payments]);
  const multiCurrency = new Set(yearly.map((y) => y.currency)).size > 1;

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
                    <button className="btn btn-sm" disabled={payingKey === `${r.kind}:${r.id}`} onClick={() => handlePay(r)}>
                      {payingKey === `${r.kind}:${r.id}` ? '…' : 'Mark paid'}
                    </button>
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

      <h2 className="section-title">Projects</h2>
      {projects.length === 0 ? (
        <div className="card"><div className="empty">No projects yet. Create your first one.</div></div>
      ) : (
        <div className="grid">
          {projects.map((p) => {
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
