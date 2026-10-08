import { useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { formatMoney, formatAmounts, formatDate } from '../format.js';
import { CURRENCIES, businessToday as today } from '../../server/money.js';
import {
  LEAD_STATUSES, LEAD_STATUS_LABEL, followUpDue, isOpenLead, leadsSummary, parseLeadsCsv,
} from '../../server/leads.js';

const STATUS_TONE = {
  new: 'neutral', contacted: 'neutral', replied: 'amber', call: 'amber', proposal: 'amber', won: 'mint', lost: 'red',
};

export default function Leads({ data, saveLead, deleteLead, importLeads, convertLead, onOpenProject }) {
  const leads = data.leads || [];
  const [filter, setFilter] = useState('open'); // open | all | <status>
  const [modal, setModal] = useState(null); // { initial? } | null
  const [importing, setImporting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const summary = useMemo(() => leadsSummary(leads, data.today), [leads, data.today]);

  const shown = leads
    .filter((l) => (filter === 'all' ? true : filter === 'open' ? isOpenLead(l) : l.status === filter))
    // Follow-ups due first, then soonest next action, then most recently touched.
    .sort((a, b) => (followUpDue(b, data.today) - followUpDue(a, data.today))
      || (a.next_action_on || '9999').localeCompare(b.next_action_on || '9999'));

  async function convert(lead) {
    if (!confirm(`Create a project for ${lead.company || lead.email} and mark the lead won?`)) return;
    setBusyId(lead.id);
    try { const project = await convertLead(lead.id); onOpenProject(project.id); }
    finally { setBusyId(null); }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="page-sub">
            {summary.open} open · {summary.followUpsDue} follow-up{summary.followUpsDue === 1 ? '' : 's'} due
            {Object.keys(summary.pipeline).length > 0 && <> · pipeline {formatAmounts(summary.pipeline, data.settings)}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setImporting(true)}>Import CSV</button>
          <button className="btn btn-primary" onClick={() => setModal({})}>+ Add lead</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {[['open', `Open (${summary.open})`], ['all', `All (${leads.length})`],
          ...LEAD_STATUSES.map((s) => [s, `${LEAD_STATUS_LABEL[s]} (${summary.byStatus[s]})`])].map(([k, label]) => (
          <button key={k} type="button" className={`pill ${filter === k ? 'accent-blue' : 'neutral'}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {shown.length === 0 ? (
          <div className="empty">{leads.length === 0 ? 'No leads yet — add one or import a CSV of your outreach list.' : 'Nothing in this view.'}</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Lead</th><th>Status</th><th>Next action</th><th className="num">Value</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((l) => {
                  const due = followUpDue(l, data.today);
                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{l.company || l.email}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[l.contact, l.email, l.source].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>
                        <select className="select" style={{ width: 'auto' }} value={l.status}
                          onChange={(e) => saveLead(l.id, { status: e.target.value })}>
                          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      <td>
                        {l.next_action || l.next_action_on ? (
                          <>
                            <div>{l.next_action || '—'}</div>
                            {l.next_action_on && (
                              <div style={{ fontSize: 12, color: due ? 'var(--color-tangerine)' : undefined }} className={due ? '' : 'muted'}>
                                {due ? 'Due ' : ''}{formatDate(l.next_action_on)}
                              </div>
                            )}
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="num">{l.value ? formatMoney(l.value, l.currency || 'USD', data.settings) : <span className="muted">—</span>}</td>
                      <td className="num">
                        <div className="row-actions">
                          {l.project_id
                            ? <button className="btn btn-sm" onClick={() => onOpenProject(l.project_id)}>Project</button>
                            : l.status !== 'lost' && (
                              <button className="btn btn-sm" disabled={busyId === l.id} onClick={() => convert(l)}>Won → project</button>
                            )}
                          <button className="btn btn-sm btn-ghost" onClick={() => setModal({ initial: l })}>Edit</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (confirm(`Delete lead ${l.company || l.email}?`)) deleteLead(l.id); }}>✕</button>
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

      {modal && (
        <LeadForm initial={modal.initial} onSubmit={(d) => saveLead(modal.initial?.id, d)} onClose={() => setModal(null)} />
      )}
      {importing && <ImportLeads onImport={importLeads} onClose={() => setImporting(false)} />}
    </main>
  );
}

function LeadForm({ initial, onSubmit, onClose }) {
  const [form, setForm] = useState({
    company: initial?.company || '', contact: initial?.contact || '', email: initial?.email || '',
    phone: initial?.phone || '', website: initial?.website || '', country: initial?.country || 'US',
    source: initial?.source || '', status: initial?.status || 'new',
    value: initial?.value ?? '', currency: initial?.currency || 'USD',
    next_action: initial?.next_action || '', next_action_on: initial?.next_action_on || '',
    notes: initial?.notes || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    if (!form.company.trim() && !form.email.trim()) { setError('Enter a company or an email.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(form); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title={initial?.id ? 'Edit lead' : 'New lead'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>Save</button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field-row">
        <div className="field"><label>Company</label><input className="input" value={form.company} onChange={set('company')} placeholder="Smith Kitchen & Bath LLC" autoFocus /></div>
        <div className="field"><label>Contact</label><input className="input" value={form.contact} onChange={set('contact')} placeholder="John Smith" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Email</label><input className="input" type="email" value={form.email} onChange={set('email')} /></div>
        <div className="field"><label>Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Website</label><input className="input" value={form.website} onChange={set('website')} /></div>
        <div className="field"><label>Country</label><input className="input" value={form.country} onChange={set('country')} maxLength={2} style={{ textTransform: 'uppercase' }} /></div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Status</label>
          <select className="select" value={form.status} onChange={set('status')}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="field"><label>Source</label><input className="input" value={form.source} onChange={set('source')} placeholder="e.g. Columbus remodelers, batch 2" /></div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Estimated value</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" type="number" min="0" step="1" value={form.value} onChange={set('value')} />
            <select className="select" style={{ width: 84 }} value={form.currency} onChange={set('currency')}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Next action on</label><input className="input" type="date" value={form.next_action_on} onChange={set('next_action_on')} /></div>
      </div>
      <div className="field"><label>Next action</label><input className="input" value={form.next_action} onChange={set('next_action')} placeholder="e.g. Follow up with case study" /></div>
      <div className="field"><label>Notes</label><textarea className="input" rows={3} value={form.notes} onChange={set('notes')} /></div>
    </Modal>
  );
}

// Paste a CSV with a header row (Company/Business name, Contact/Owner, Email,
// Phone, Website, City, Source, Notes, Country). Leads whose email already
// exists are skipped.
function ImportLeads({ onImport, onClose }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => parseLeadsCsv(text), [text]);

  async function readFile(e) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  }
  async function submit() {
    setBusy(true); setError('');
    try { setResult(await onImport(rows, source.trim())); } catch (e) { setError(e.message); }
    setBusy(false);
  }

  return (
    <Modal
      title="Import leads"
      onClose={onClose}
      footer={result ? <button className="btn btn-primary" onClick={onClose}>Done</button> : (
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || rows.length === 0}>Import {rows.length || ''}</button>
        </>
      )}
    >
      {error && <div className="form-error">{error}</div>}
      {result ? (
        <p>Added <strong>{result.added}</strong> lead{result.added === 1 ? '' : 's'}{result.skipped ? `, skipped ${result.skipped} already in the list` : ''}.</p>
      ) : (
        <>
          <div className="field">
            <label>CSV file or pasted text (first row = headers)</label>
            <input type="file" accept=".csv,text/csv" onChange={readFile} style={{ marginBottom: 6 }} />
            <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'Business Name,Owner,Email,City\nSmith Kitchen & Bath,John,john@example.com,Columbus OH'} />
          </div>
          <div className="field">
            <label>Source (applied to every row without one)</label>
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder={`e.g. Cold email ${today()}`} />
          </div>
          <p className="inline-note">{rows.length} lead{rows.length === 1 ? '' : 's'} recognised.</p>
        </>
      )}
    </Modal>
  );
}
