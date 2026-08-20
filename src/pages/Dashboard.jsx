import { useMemo, useState } from 'react';
import { chargeStatus, chargeMrr, paymentsRollup } from '../../server/money.js';
import { formatMoney, formatDate, FREQUENCY_LABEL } from '../format.js';
import { packageMeta } from '../catalog.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProjectForm from '../components/ProjectForm.jsx';

export default function Dashboard({ data, onOpenProject, createProject, payCharge }) {
  const { projects, charges, payments, settings, today } = data;
  const [showNew, setShowNew] = useState(false);
  const [payingId, setPayingId] = useState(null);

  const totals = useMemo(() => {
    const { revenue, expenses, profit } = paymentsRollup(payments);
    const mrr = charges.reduce((s, c) => s + chargeMrr(c), 0);
    return { revenue, expenses, profit, mrr };
  }, [charges, payments]);

  const byProject = useMemo(() => {
    const m = new Map(projects.map((p) => [p.id, { charges: [], payments: [] }]));
    charges.forEach((c) => m.get(c.project_id)?.charges.push(c));
    payments.forEach((p) => m.get(p.project_id)?.payments.push(p));
    return m;
  }, [projects, charges, payments]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';

  const scheduled = useMemo(() => {
    return charges
      .filter((c) => c.active && c.next_due)
      .map((c) => ({ ...c, status: chargeStatus(c.next_due, today) }))
      .filter((c) => c.status === 'overdue' || c.status === 'due_soon')
      .sort((a, b) => a.next_due.localeCompare(b.next_due));
  }, [charges, today]);

  async function handlePay(id) {
    setPayingId(id);
    try { await payCharge(id); } finally { setPayingId(null); }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{projects.length} project{projects.length === 1 ? '' : 's'} · realized totals shown in {settings.display_currency}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New project</button>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="label">Total revenue</div>
          <div className="value blue">{formatMoney(totals.revenue, settings)}</div>
          <div className="hint">Paid income, all time</div>
        </div>
        <div className="kpi">
          <div className="label">Total expenses</div>
          <div className="value">{formatMoney(totals.expenses, settings)}</div>
          <div className="hint">What I've spent</div>
        </div>
        <div className="kpi">
          <div className="label">Net profit</div>
          <div className={`value ${totals.profit >= 0 ? 'pos' : 'neg'}`}>{formatMoney(totals.profit, settings)}</div>
          <div className="hint">Revenue − expenses</div>
        </div>
        <div className="kpi">
          <div className="label">Recurring / mo (MRR)</div>
          <div className="value">{formatMoney(totals.mrr, settings)}</div>
          <div className="hint">Active maintenance + monthly</div>
        </div>
      </div>

      <h2 className="section-title">Scheduled — due soon &amp; overdue</h2>
      <div className="card" style={{ padding: 0 }}>
        {scheduled.length === 0 ? (
          <div className="empty">Nothing due right now. 🎉</div>
        ) : (
          <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th><th>Charge</th><th>Next due</th><th>Status</th>
                <th className="num">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map((c) => (
                <tr key={c.id}>
                  <td><a onClick={() => onOpenProject(c.project_id)} style={{ cursor: 'pointer' }}>{projectName(c.project_id)}</a></td>
                  <td>{c.label || c.category} <span className="muted">{FREQUENCY_LABEL[c.frequency]}</span></td>
                  <td>{formatDate(c.next_due)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="num">{formatMoney(c.amount, settings)}</td>
                  <td className="num">
                    <button className="btn btn-sm" disabled={payingId === c.id} onClick={() => handlePay(c.id)}>
                      {payingId === c.id ? '…' : 'Mark paid'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <h2 className="section-title">Projects</h2>
      {projects.length === 0 ? (
        <div className="card"><div className="empty">No projects yet. Create your first one.</div></div>
      ) : (
        <div className="grid">
          {projects.map((p) => {
            const bucket = byProject.get(p.id) || { charges: [], payments: [] };
            const roll = paymentsRollup(bucket.payments);
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
                    <div className="m-value">{formatMoney(roll.revenue, settings)}</div>
                  </div>
                  <div className="metric">
                    <div className="m-label">Profit</div>
                    <div className="m-value">{formatMoney(roll.profit, settings)}</div>
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
    </main>
  );
}
