import { useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { formatMoney, formatDate } from '../format.js';
import { downloadInvoicePdf } from '../invoicePdf.js';

const today = () => new Date().toISOString().slice(0, 10);
const CURRENCIES = [['RSD', 'RSD (dinari)'], ['EUR', 'EUR (€)'], ['BOTH', 'Both (RSD + €)']];

export default function Invoices({ data, createInvoice, deleteInvoice }) {
  const { invoices, projects, charges, settings } = data;
  const [showNew, setShowNew] = useState(false);
  const hasSellerPib = Boolean(settings.seller_pib && settings.seller_pib.trim());

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">
            {hasSellerPib ? 'Issuing računi' : 'Issuing predračuni'} · {invoices.length} total
            {!hasSellerPib && ' · add your PIB in Settings to issue računi'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New invoice</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {invoices.length === 0 ? (
          <div className="empty">No invoices yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th><th>Kind</th><th>Client</th><th>Issued</th>
                  <th className="num">Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const buyer = JSON.parse(inv.buyer_json || '{}');
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 500 }}>{inv.number}</td>
                      <td><span className={`pill ${inv.kind === 'racun' ? 'mint' : 'neutral'}`}><span className="dot" />{inv.kind === 'racun' ? 'Račun' : 'Predračun'}</span></td>
                      <td>{buyer.name || '—'}</td>
                      <td>{formatDate(inv.issued_on)}</td>
                      <td className="num">{formatMoney(inv.subtotal_eur, settings)}</td>
                      <td className="num">
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => downloadInvoicePdf(inv)}>Download PDF</button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { if (confirm(`Delete invoice ${inv.number}?`)) deleteInvoice(inv.id); }}>✕</button>
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

      {showNew && (
        <InvoiceForm projects={projects} charges={charges} settings={settings}
          onSubmit={createInvoice} onClose={() => setShowNew(false)} />
      )}
    </main>
  );
}

function InvoiceForm({ projects, charges, settings, onSubmit, onClose }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [supplyDate, setSupplyDate] = useState(today());
  const [place, setPlace] = useState('');
  const [currency, setCurrency] = useState('RSD');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [exempt, setExempt] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed line items from the selected project's income charges.
  const seededFor = useMemo(() => {
    const rows = charges
      .filter((c) => c.project_id === Number(projectId) && c.direction === 'income')
      .map((c) => ({ description: c.label || c.category, qty: 1, unit_eur: c.amount, include: true }));
    return { projectId, rows };
  }, [projectId, charges]);

  // Reset lines whenever the project changes.
  const [lastSeed, setLastSeed] = useState(null);
  if (lastSeed !== seededFor.projectId) {
    setLastSeed(seededFor.projectId);
    setLines(seededFor.rows.length ? seededFor.rows : [{ description: '', qty: 1, unit_eur: '', include: true }]);
  }

  const setLine = (idx, k, v) => setLines(lines.map((l, i) => (i === idx ? { ...l, [k]: v } : l)));
  const addLine = () => setLines([...lines, { description: '', qty: 1, unit_eur: '', include: true }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const total = lines
    .filter((l) => l.include)
    .reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_eur) || 0), 0);

  // PDV preview — only when in the PDV system and the invoice isn't exempt.
  const pdvRate = settings.pdv_obveznik && !exempt ? (Number(settings.pdv_rate) || 0) : 0;
  const pdv = total * pdvRate / 100;

  async function submit() {
    const items = lines
      .filter((l) => l.include && l.description.trim())
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 0, unit_eur: Number(l.unit_eur) || 0 }));
    if (!projectId) { setError('Pick a project.'); return; }
    if (items.length === 0) { setError('Add at least one line item with a description.'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit({ project_id: Number(projectId), supply_date: supplyDate, place, currency, note, items, pdv_exempt: exempt });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title="New invoice"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>Create invoice</button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field-row">
        <div className="field">
          <label>Project / client</label>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.client || p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Currency</label>
          <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Datum prometa (supply date)</label>
          <input type="date" className="input" value={supplyDate} onChange={(e) => setSupplyDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Mesto (place)</label>
          <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Leskovac" />
        </div>
      </div>

      <div className="field">
        <label>Line items</label>
        {lines.map((l, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input type="checkbox" checked={l.include} onChange={(e) => setLine(idx, 'include', e.target.checked)} />
            <input className="input" style={{ flex: 3 }} value={l.description} onChange={(e) => setLine(idx, 'description', e.target.value)} placeholder="Opis" />
            <input className="input" style={{ width: 56 }} type="number" min="0" step="1" value={l.qty} onChange={(e) => setLine(idx, 'qty', e.target.value)} title="Količina" />
            <input className="input" style={{ width: 84 }} type="number" min="0" step="0.01" value={l.unit_eur} onChange={(e) => setLine(idx, 'unit_eur', e.target.value)} placeholder="€ cena" title="Jed. cena (EUR)" />
            <button className="btn btn-sm btn-ghost btn-danger" onClick={() => removeLine(idx)}>✕</button>
          </div>
        ))}
        <button className="btn btn-sm btn-ghost" onClick={addLine}>+ Add line</button>
      </div>

      {settings.pdv_obveznik ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
          <span>PDV se ne obračunava (inostrani kupac / izvoz usluga)</span>
        </label>
      ) : null}

      <div style={{ borderTop: '1px solid var(--color-ash)', paddingTop: 10, marginTop: 10 }}>
        {pdvRate > 0 && (
          <>
            <div className="kv"><span className="k">Osnovica</span><span className="v">{formatMoney(total, settings)}</span></div>
            <div className="kv"><span className="k">PDV ({pdvRate}%)</span><span className="v">{formatMoney(pdv, settings)}</span></div>
          </>
        )}
        <div className="kv">
          <span className="k">{pdvRate > 0 ? 'Ukupno (sa PDV-om)' : 'Total (EUR base)'}</span>
          <span className="v">{formatMoney(total + pdv, settings)}</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Napomena (note)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </div>
    </Modal>
  );
}
