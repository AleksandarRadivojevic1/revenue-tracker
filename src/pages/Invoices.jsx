import { useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { formatMoney, formatDate, CURRENCY_LABEL } from '../format.js';
import { downloadInvoicePdf } from '../invoicePdf.js';
import { CURRENCIES, businessToday as today, currencyOf } from '../../server/money.js';

// Display modes of a Serbian EUR document (amounts stay EUR; RSD via the rate).
const DISPLAY_MODES = [['RSD', 'RSD (dinari)'], ['EUR', 'EUR (€)'], ['BOTH', 'Both (RSD + €)']];
const TERMS = ['Due on receipt', 'Net 7', 'Net 14'];
const STAGES = [['full', 'Full invoice'], ['deposit', 'Deposit'], ['balance', 'Balance']];
const STAGE_LABEL = { deposit: 'Deposit', balance: 'Balance' };

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const docCurrency = (inv) => inv.doc_currency || 'EUR';
const docTotal = (inv) => inv.total ?? (inv.total_eur || inv.subtotal_eur);

export default function Invoices({ data, createInvoice, voidInvoice }) {
  const { invoices, projects, charges, settings } = data;
  const [showNew, setShowNew] = useState(false);
  const hasSellerPib = Boolean(settings.seller_pib && settings.seller_pib.trim());
  const issuedCount = invoices.filter((i) => i.status !== 'void').length;

  function kindLabel(inv) {
    if (inv.lang === 'en') return STAGE_LABEL[inv.stage] ? `Invoice · ${STAGE_LABEL[inv.stage]}` : 'Invoice';
    return inv.kind === 'racun' ? 'Račun' : 'Predračun';
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">
            {hasSellerPib ? 'Issuing računi' : 'Issuing predračuni'} · {issuedCount} issued
            {issuedCount !== invoices.length && ` · ${invoices.length - issuedCount} void`}
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
                  <th>Number</th><th>Kind</th><th>Client</th><th>Issued</th><th>Due</th>
                  <th className="num">Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const buyer = parse(inv.buyer_json);
                  const isVoid = inv.status === 'void';
                  return (
                    <tr key={inv.id} style={isVoid ? { opacity: 0.55 } : undefined}>
                      <td style={{ fontWeight: 500 }}>{inv.number}</td>
                      <td>
                        {isVoid
                          ? <span className="pill red"><span className="dot" />Void</span>
                          : <span className={`pill ${inv.kind === 'racun' || inv.lang === 'en' ? 'mint' : 'neutral'}`}><span className="dot" />{kindLabel(inv)}</span>}
                      </td>
                      <td>{buyer.name || '—'}</td>
                      <td>{formatDate(inv.issued_on)}</td>
                      <td>{inv.due_on ? formatDate(inv.due_on) : <span className="muted">—</span>}</td>
                      <td className="num" style={isVoid ? { textDecoration: 'line-through' } : undefined}>
                        {formatMoney(docTotal(inv), docCurrency(inv), docCurrency(inv) === 'EUR' ? settings : undefined)}
                      </td>
                      <td className="num">
                        <div className="row-actions">
                          <button className="btn btn-sm" onClick={() => downloadInvoicePdf(inv)}>PDF</button>
                          {!isVoid && (
                            <button className="btn btn-sm btn-ghost btn-danger" title="Void — keeps the number, stamps the PDF VOID"
                              onClick={() => { if (confirm(`Void invoice ${inv.number}? The number stays used and the PDF is stamped VOID. This can't be undone.`)) voidInvoice(inv.id); }}>
                              Void
                            </button>
                          )}
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
        <InvoiceForm projects={projects} charges={charges} invoices={invoices} settings={settings}
          onSubmit={createInvoice} onClose={() => setShowNew(false)} />
      )}
    </main>
  );
}

function InvoiceForm({ projects, charges, invoices, settings, onSubmit, onClose }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const project = projects.find((p) => p.id === Number(projectId));
  const isForeign = (project?.client_country || 'RS') !== 'RS';

  const [supplyDate, setSupplyDate] = useState(today());
  const [place, setPlace] = useState('');
  const [displayMode, setDisplayMode] = useState('RSD');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [exempt, setExempt] = useState(false);
  const [lang, setLang] = useState('sr');
  const [docCur, setDocCur] = useState('EUR');
  const [terms, setTerms] = useState('Due on receipt');
  const [stage, setStage] = useState('full');
  const [depositRef, setDepositRef] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed line items from the selected project's income charges in the
  // invoice's currency.
  const seededFor = useMemo(() => {
    const rows = charges
      .filter((c) => c.project_id === Number(projectId) && c.direction === 'income' && currencyOf(c) === docCur)
      .map((c) => ({ description: c.label || c.category, qty: 1, unit: c.amount, include: true }));
    return { key: `${projectId}:${docCur}`, rows };
  }, [projectId, docCur, charges]);

  // When the project changes, language/currency/exemption follow its client.
  const [lastProject, setLastProject] = useState(null);
  if (lastProject !== projectId) {
    setLastProject(projectId);
    setLang(isForeign ? 'en' : 'sr');
    setDocCur(project?.currency || 'EUR');
    setExempt(isForeign);
    setStage('full');
    setDepositRef('');
  }
  // Reset lines whenever the project or currency changes.
  const [lastSeed, setLastSeed] = useState(null);
  if (lastSeed !== seededFor.key) {
    setLastSeed(seededFor.key);
    setLines(seededFor.rows.length ? seededFor.rows : [{ description: '', qty: 1, unit: '', include: true }]);
  }

  const setLine = (idx, k, v) => setLines(lines.map((l, i) => (i === idx ? { ...l, [k]: v } : l)));
  const addLine = () => setLines([...lines, { description: '', qty: 1, unit: '', include: true }]);
  const removeLine = (idx) => setLines(lines.filter((_, i) => i !== idx));

  const total = lines
    .filter((l) => l.include)
    .reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0);

  // PDV preview — only when in the PDV system and the invoice isn't exempt.
  const pdvRate = settings.pdv_obveznik && !exempt ? (Number(settings.pdv_rate) || 0) : 0;
  const pdv = total * pdvRate / 100;
  // Preview in the document's own currency; a Serbian EUR doc honors the toggle.
  const fmt = (n) => formatMoney(n, docCur, docCur === 'EUR' && lang === 'sr' ? settings : undefined);

  const en = lang === 'en';
  const depositInvoices = invoices.filter((i) => i.project_id === Number(projectId) && i.stage === 'deposit' && i.status !== 'void');
  const payout = (() => { try { return JSON.parse(settings.payout_usd_json || '{}'); } catch { return {}; } })();
  const missingPayout = docCur === 'USD' && project?.client_type !== 'individual' && !(payout.routing_aba && payout.account_number);
  const registered = Boolean(settings.seller_pib && settings.seller_pib.trim());
  const individualWarning = registered && isForeign && project?.client_type === 'individual';

  async function submit() {
    const items = lines
      .filter((l) => l.include && l.description.trim())
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 0, unit: Number(l.unit) || 0 }));
    if (!projectId) { setError('Pick a project.'); return; }
    if (items.length === 0) { setError('Add at least one line item with a description.'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit({
        project_id: Number(projectId), supply_date: supplyDate, place, currency: displayMode, note, items,
        pdv_exempt: exempt, lang, doc_currency: docCur,
        ...(en ? { terms, stage, deposit_ref: stage === 'balance' ? depositRef : '' } : {}),
      });
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
      {missingPayout && (
        <div className="form-error">Add your USD payout account in Settings first — a US company invoice must carry the ACH details.</div>
      )}
      {individualWarning && (
        <div className="form-error" style={{ background: '#fef3c7', color: '#92620a' }}>
          You're registered and this client is an individual. A sale to a foreign individual likely needs a fiscal
          receipt, which this app can't produce — check with your accountant before issuing.
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label>Project / client</label>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.client_legal_name || p.client || p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Language</label>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="sr">Srpski (predračun / račun)</option>
            <option value="en">English (US invoice)</option>
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Invoice currency</label>
          <select className="select" value={docCur} onChange={(e) => setDocCur(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
          </select>
        </div>
        {!en && docCur === 'EUR' ? (
          <div className="field">
            <label>Show amounts as</label>
            <select className="select" value={displayMode} onChange={(e) => setDisplayMode(e.target.value)}>
              {DISPLAY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ) : en ? (
          <div className="field">
            <label>Payment terms</label>
            <select className="select" value={terms} onChange={(e) => setTerms(e.target.value)}>
              {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        ) : <div className="field" />}
      </div>

      {en && (
        <div className="field-row">
          <div className="field">
            <label>Stage</label>
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {stage === 'balance' ? (
            <div className="field">
              <label>Deposit invoice</label>
              <select className="select" value={depositRef} onChange={(e) => setDepositRef(e.target.value)}>
                <option value="">—</option>
                {depositInvoices.map((i) => <option key={i.id} value={i.number}>{i.number}</option>)}
              </select>
            </div>
          ) : <div className="field" />}
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label>{en ? 'Service date' : 'Datum prometa (supply date)'}</label>
          <input type="date" className="input" value={supplyDate} onChange={(e) => setSupplyDate(e.target.value)} />
        </div>
        {!en ? (
          <div className="field">
            <label>Mesto (place)</label>
            <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Leskovac" />
          </div>
        ) : <div className="field" />}
      </div>

      <div className="field">
        <label>Line items ({docCur})</label>
        {lines.map((l, idx) => (
          <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input type="checkbox" checked={l.include} onChange={(e) => setLine(idx, 'include', e.target.checked)} />
            <input className="input" style={{ flex: 3 }} value={l.description} onChange={(e) => setLine(idx, 'description', e.target.value)} placeholder={en ? 'Description' : 'Opis'} />
            <input className="input" style={{ width: 56 }} type="number" min="0" step="1" value={l.qty} onChange={(e) => setLine(idx, 'qty', e.target.value)} title={en ? 'Qty' : 'Količina'} />
            <input className="input" style={{ width: 84 }} type="number" min="0" step="0.01" value={l.unit} onChange={(e) => setLine(idx, 'unit', e.target.value)} placeholder={docCur} title={`Unit price (${docCur})`} />
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
            <div className="kv"><span className="k">Osnovica</span><span className="v">{fmt(total)}</span></div>
            <div className="kv"><span className="k">PDV ({pdvRate}%)</span><span className="v">{fmt(pdv)}</span></div>
          </>
        )}
        <div className="kv">
          <span className="k">{pdvRate > 0 ? 'Ukupno (sa PDV-om)' : `Total (${docCur})`}</span>
          <span className="v">{fmt(total + pdv)}</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>{en ? 'Note' : 'Napomena (note)'}</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </div>
    </Modal>
  );
}
