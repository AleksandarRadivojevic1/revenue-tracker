import { useMemo, useState } from 'react';
import { chargeStatus, projectRollup } from '../../server/money.js';
import { formatMoney, formatDate, FREQUENCY_LABEL } from '../format.js';
import { packageMeta } from '../catalog.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import ChargeForm from '../components/ChargeForm.jsx';

export default function ProjectDetail({
  data, projectId, onBack,
  updateProject, deleteProject, createCharge, updateCharge, deleteCharge, payCharge, deletePayment,
}) {
  const { settings, today } = data;
  const project = data.projects.find((p) => p.id === projectId);
  const [editProject, setEditProject] = useState(false);
  const [chargeModal, setChargeModal] = useState(null); // { initial?, defaultDirection }
  const [busyId, setBusyId] = useState(null);

  const charges = useMemo(() => data.charges.filter((c) => c.project_id === projectId), [data.charges, projectId]);
  const payments = useMemo(() => data.payments.filter((p) => p.project_id === projectId), [data.payments, projectId]);
  const roll = useMemo(() => projectRollup(charges, payments), [charges, payments]);

  if (!project) return <main className="page"><button className="back-link" onClick={onBack}>← Back</button><p>Project not found.</p></main>;

  const pkg = packageMeta(project.package);
  const income = charges.filter((c) => c.direction === 'income');
  const expense = charges.filter((c) => c.direction === 'expense');

  async function pay(id) { setBusyId(id); try { await payCharge(id); } finally { setBusyId(null); } }
  async function removeCharge(id) { setBusyId(id); try { await deleteCharge(id); } finally { setBusyId(null); } }

  function ChargeTable({ rows, title, dir }) {
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px' }}>
          <h2 className="section-title" style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-sm" onClick={() => setChargeModal({ defaultDirection: dir })}>+ Add</button>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {rows.length === 0 ? <div className="empty">None yet.</div> : (
            <table className="table">
              <thead>
                <tr><th>Label</th><th>Freq</th><th>Next due</th><th></th><th className="num">Amount</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const status = c.active && c.next_due ? chargeStatus(c.next_due, today) : (c.active ? null : 'paid');
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{c.label || c.category}</div>
                        <div className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{c.category}{!c.active && ' · inactive'}</div>
                      </td>
                      <td className="muted">{FREQUENCY_LABEL[c.frequency] === '/mo' ? 'Monthly' : FREQUENCY_LABEL[c.frequency] === '/yr' ? 'Yearly' : 'One-time'}</td>
                      <td>{c.frequency === 'one_time' && !c.active ? <span className="muted">—</span> : formatDate(c.next_due)}</td>
                      <td>{status ? <StatusBadge status={status} /> : <span className="muted">—</span>}</td>
                      <td className="num">{formatMoney(c.amount, settings)}</td>
                      <td>
                        <div className="row-actions">
                          {c.active && <button className="btn btn-sm" disabled={busyId === c.id} onClick={() => pay(c.id)}>Paid</button>}
                          <button className="btn btn-sm btn-ghost" onClick={() => setChargeModal({ initial: c })}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" disabled={busyId === c.id} onClick={() => removeCharge(c.id)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </>
    );
  }

  return (
    <main className="page">
      <button className="back-link" onClick={onBack}>← Back to dashboard</button>

      <div className="page-head">
        <div>
          <div className="link-row">
            <h1 className="page-title">{project.name}</h1>
            {pkg && <span className={`pill accent-${pkg.accent}`}><span className="dot" />{pkg.name}</span>}
            <span className="pill neutral" style={{ textTransform: 'capitalize' }}>{project.status}</span>
          </div>
          <p className="page-sub">
            {project.client || 'No client'}
            {project.url && <> · <a href={project.url.startsWith('http') ? project.url : `https://${project.url}`} target="_blank" rel="noreferrer">{project.url}</a></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setEditProject(true)}>Edit</button>
          <button className="btn btn-danger" onClick={() => { if (confirm('Delete this project and all its charges/payments?')) deleteProject(project.id); }}>Delete</button>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <ChargeTable rows={income} title="Income — build, maintenance, features" dir="income" />
          <div style={{ height: 20 }} />
          <ChargeTable rows={expense} title="Expenses — what I spend" dir="expense" />
        </div>

        <div className="stack">
          <div className="card">
            <h2 className="section-title" style={{ marginTop: 0 }}>This site</h2>
            <div className="kv"><span className="k">Revenue (paid)</span><span className="v blue">{formatMoney(roll.revenue, settings)}</span></div>
            <div className="kv"><span className="k">Expenses (paid)</span><span className="v">{formatMoney(roll.expenses, settings)}</span></div>
            <div className="kv"><span className="k">Profit</span><span className="v" style={{ color: roll.profit >= 0 ? 'var(--color-vivid-green)' : 'var(--color-tangerine)' }}>{formatMoney(roll.profit, settings)}</span></div>
            <div className="kv"><span className="k">Recurring / mo</span><span className="v">{formatMoney(roll.mrr, settings)}</span></div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h2 className="section-title" style={{ margin: '16px 16px 8px' }}>Payment history</h2>
            {payments.length === 0 ? <div className="empty">No payments logged.</div> : (
              <table className="table">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{formatMoney(p.amount, settings)} <span className="pill neutral" style={{ marginLeft: 4 }}>{p.direction}</span></div>
                        <div className="muted" style={{ fontSize: 12 }}>{formatDate(p.paid_on)} · {p.note}</div>
                      </td>
                      <td className="num">
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => deletePayment(p.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {project.notes && <div className="card"><h2 className="section-title" style={{ marginTop: 0 }}>Notes</h2><p style={{ margin: 0 }}>{project.notes}</p></div>}
        </div>
      </div>

      {editProject && (
        <ProjectForm initial={project} settings={settings}
          onSubmit={(form) => updateProject(project.id, form)} onClose={() => setEditProject(false)} />
      )}
      {chargeModal && (
        <ChargeForm
          initial={chargeModal.initial}
          defaultDirection={chargeModal.defaultDirection || 'income'}
          onSubmit={(d) => chargeModal.initial
            ? updateCharge(chargeModal.initial.id, d)
            : createCharge({ ...d, project_id: project.id })}
          onClose={() => setChargeModal(null)}
        />
      )}
    </main>
  );
}
