import { useMemo, useState } from 'react';
import { chargePaidSoFar, chargeRemaining, chargeStatus, currencyOf, perCurrency, projectRollup } from '../../server/money.js';
import { formatMoney, formatAmounts, formatDate, FREQUENCY_LABEL } from '../format.js';
import { packageMeta } from '../catalog.js';
import StatusBadge from '../components/StatusBadge.jsx';
import ProjectForm from '../components/ProjectForm.jsx';
import ChargeForm from '../components/ChargeForm.jsx';
import PaymentForm from '../components/PaymentForm.jsx';
import ChargePayForm from '../components/ChargePayForm.jsx';
import { InvoiceForm, invoicedPeriods } from './Invoices.jsx';

export default function ProjectDetail({
  data, projectId, onBack,
  updateProject, deleteProject, createCharge, updateCharge, deleteCharge, payCharge, updatePayment, deletePayment,
  createInvoice,
}) {
  const { settings, today } = data;
  const project = data.projects.find((p) => p.id === projectId);
  const [editProject, setEditProject] = useState(false);
  const [chargeModal, setChargeModal] = useState(null); // { initial?, defaultDirection }
  const [editPayment, setEditPayment] = useState(null); // payment row being edited
  const [busyId, setBusyId] = useState(null);
  const [invoicing, setInvoicing] = useState(null); // charge to invoice
  const [payingCharge, setPayingCharge] = useState(null); // charge being paid (full or part)
  const [historyOpen, setHistoryOpen] = useState(null); // payment id whose edit history is shown
  const invoiced = useMemo(() => invoicedPeriods(data.invoices || []), [data.invoices]);

  const charges = useMemo(() => data.charges.filter((c) => c.project_id === projectId), [data.charges, projectId]);
  const payments = useMemo(() => data.payments.filter((p) => p.project_id === projectId), [data.payments, projectId]);
  // One rollup per currency in use — EUR and USD are never added together.
  const roll = useMemo(
    () => perCurrency([charges, payments], (c) => projectRollup(charges, payments, c)),
    [charges, payments]
  );
  const fmtRoll = (k) => formatAmounts(roll, settings, (r) => r[k]);
  // Edit history per payment (audit_log), newest first.
  const auditByPayment = useMemo(() => {
    const m = new Map();
    for (const a of data.audit_log || []) {
      if (a.entity !== 'payment') continue;
      if (!m.has(a.entity_id)) m.set(a.entity_id, []);
      m.get(a.entity_id).push(a);
    }
    return m;
  }, [data.audit_log]);
  const projectInvoices = (data.invoices || []).filter((i) => i.project_id === projectId);
  const profitPositive = Object.values(roll).every((r) => r.profit >= 0);

  if (!project) return <main className="page"><button className="back-link" onClick={onBack}>← Back</button><p>Project not found.</p></main>;

  const pkg = packageMeta(project.package);
  const income = charges.filter((c) => c.direction === 'income');
  const expense = charges.filter((c) => c.direction === 'expense');

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
            <div className="table-scroll">
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
                      <td className="num">
                        {formatMoney(c.amount, currencyOf(c), settings)}
                        {c.active && chargePaidSoFar(c, data.payments) > 0 && (
                          <div className="muted" style={{ fontSize: 12 }}>{formatMoney(chargeRemaining(c, data.payments), currencyOf(c), settings)} left</div>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {c.active && c.direction === 'income' && (invoiced.get(`${c.id}:${c.next_due}`)
                            ? <span className="muted" style={{ fontSize: 12 }}>Inv. {invoiced.get(`${c.id}:${c.next_due}`)}</span>
                            : <button className="btn btn-sm btn-ghost" onClick={() => setInvoicing(c)}>Invoice</button>)}
                          {c.active && <button className="btn btn-sm" disabled={busyId === c.id} onClick={() => setPayingCharge(c)}>Paid</button>}
                          <button className="btn btn-sm btn-ghost" onClick={() => setChargeModal({ initial: c })}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" disabled={busyId === c.id} onClick={() => removeCharge(c.id)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
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
            {(project.client_country || 'RS') !== 'RS' && <span className="pill accent-blue"><span className="dot" />{project.client_country} · {project.currency}</span>}
            {pkg && <span className={`pill accent-${pkg.accent}`}><span className="dot" />{pkg.name}</span>}
            <span className="pill neutral" style={{ textTransform: 'capitalize' }}>{project.status}</span>
          </div>
          <p className="page-sub">
            {project.client || 'No client'}
            {project.url && <> · <a href={project.url.startsWith('http') ? project.url : `https://${project.url}`} target="_blank" rel="noreferrer">{project.url}</a></>}
            {project.site_slug && settings.seo_cockpit_url && (
              <> · SEO cockpit:{' '}
                <a href={`${settings.seo_cockpit_url}/site/${project.site_slug}`} target="_blank" rel="noreferrer">site</a>{' / '}
                <a href={`${settings.seo_cockpit_url}/site/${project.site_slug}/report`} target="_blank" rel="noreferrer">report</a>
              </>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setEditProject(true)}>Edit</button>
          {payments.length > 0 || projectInvoices.length > 0 ? (
            // Money history is tax evidence — a project with any is archived, never deleted.
            project.status === 'archived'
              ? <button className="btn" onClick={() => updateProject(project.id, { status: 'active' })}>Unarchive</button>
              : <button className="btn" title="Has payments or invoices, so it can't be deleted" onClick={() => { if (confirm('Archive this project? It stays in all totals and history, hidden from the dashboard.')) updateProject(project.id, { status: 'archived' }); }}>Archive</button>
          ) : (
            <button className="btn btn-danger" onClick={() => { if (confirm('Delete this project and its charges? It has no payments or invoices.')) deleteProject(project.id); }}>Delete</button>
          )}
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
            <div className="kv"><span className="k">Revenue (paid)</span><span className="v blue">{fmtRoll('revenue')}</span></div>
            <div className="kv"><span className="k">Expenses (paid, incl. fees)</span><span className="v">{fmtRoll('expenses')}</span></div>
            <div className="kv"><span className="k">Profit</span><span className="v" style={{ color: profitPositive ? 'var(--color-vivid-green)' : 'var(--color-tangerine)' }}>{fmtRoll('profit')}</span></div>
            <div className="kv"><span className="k">Recurring / mo</span><span className="v">{fmtRoll('mrr')}</span></div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <h2 className="section-title" style={{ margin: '16px 16px 8px' }}>Payment history</h2>
            {payments.length === 0 ? <div className="empty">No payments logged.</div> : (
              <table className="table">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>
                          {formatMoney(p.amount, currencyOf(p), settings)} <span className="pill neutral" style={{ marginLeft: 4 }}>{p.direction}</span>
                          {auditByPayment.has(p.id) && (
                            <button type="button" className="pill amber" style={{ marginLeft: 4 }} title="Show edit history"
                              onClick={() => setHistoryOpen(historyOpen === p.id ? null : p.id)}>edited</button>
                          )}
                        </div>
                        {historyOpen === p.id && (
                          <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                            {auditByPayment.get(p.id).map((a) => (
                              <div key={a.id}>{a.changed_at.slice(0, 16)} · {a.field}: {a.old ?? '—'} → {a.new ?? '—'}</div>
                            ))}
                          </div>
                        )}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatDate(p.paid_on)} · {p.note}
                          {p.fee > 0 && <> · fee {formatMoney(p.fee, currencyOf(p), settings)}</>}
                          {p.direction === 'income' && p.channel && p.channel !== 'domestic' && p.amount_rsd == null && currencyOf(p) !== 'RSD' && (
                            <> · <span style={{ color: 'var(--color-tangerine)' }}>NBS rate missing</span></>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditPayment(p)}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (confirm('Delete this payment? It leaves your totals; a copy is kept in the edit log.')) deletePayment(p.id); }}>✕</button>
                        </div>
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
          defaultCurrency={project.currency || 'EUR'}
          onSubmit={(d) => chargeModal.initial
            ? updateCharge(chargeModal.initial.id, d)
            : createCharge({ ...d, project_id: project.id })}
          onClose={() => setChargeModal(null)}
        />
      )}
      {payingCharge && (
        <ChargePayForm charge={payingCharge} payments={data.payments} settings={settings}
          onSubmit={(d) => payCharge(payingCharge.id, d)} onClose={() => setPayingCharge(null)} />
      )}
      {invoicing && (
        <InvoiceForm projects={data.projects} charges={data.charges} invoices={data.invoices || []} settings={settings}
          forCharge={invoicing} onSubmit={createInvoice} onClose={() => setInvoicing(null)} />
      )}
      {editPayment && (
        <PaymentForm
          initial={editPayment}
          taxBasis={settings.tax_date_basis}
          onSubmit={(d) => updatePayment(editPayment.id, d)}
          onClose={() => setEditPayment(null)}
        />
      )}
    </main>
  );
}
