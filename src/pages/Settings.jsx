import { useState } from 'react';
import { formatMoney } from '../format.js';
import { isValidAba } from '../../server/money.js';

const SELLER_FIELDS = [
  ['seller_name', 'Naziv (ime / firma)', 'Aleksandar Radivojević PR'],
  ['seller_address', 'Adresa', 'Ulica i broj, grad'],
  ['seller_pib', 'PIB', '9 cifara — postavlja se → računi'],
  ['seller_mb', 'Matični broj (MB)', '8 cifara'],
  ['seller_bank', 'Tekući račun', '160-0000000000000-00'],
  ['seller_note', 'Napomena (podrazumevana)', 'Optional default note'],
];

// English (US invoice) identity. Name and address must match the Payoneer
// profile character for character — the payer's bank checks them.
const SELLER_EN_FIELDS = [
  ['seller_name_en', 'Legal name — ASCII, exactly as on Payoneer', 'First Last (no ć/č/š/ž/đ)'],
  ['seller_brand', 'Brand (header only, never the beneficiary)', 'Studio name — no LLC / Inc until registered'],
  ['seller_address_en', 'Address — exactly as on Payoneer', 'Street and number\nCity ZIP\nSerbia', true],
  ['seller_email', 'Email', 'billing@yourdomain.com'],
  ['seller_phone', 'Phone', '+1 …'],
];

// USD receiving account. Stored only in this database — never in the repo.
const PAYOUT_FIELDS = [
  ['beneficiary_name', 'Beneficiary name', 'As shown in Payoneer receiving accounts'],
  ['beneficiary_address', 'Beneficiary address', '', true],
  ['bank_name', 'Bank name', ''],
  ['bank_address', 'Bank address', '', true],
  ['routing_aba', 'Routing number (ABA)', '9 digits'],
  ['account_number', 'Account number', ''],
  ['account_type', 'Account type', 'Checking'],
];

const parsePayout = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

export default function Settings({ data, saveSettings }) {
  const { settings } = data;
  const [rate, setRate] = useState(settings.eur_to_rsd);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [seller, setSeller] = useState(
    Object.fromEntries(SELLER_FIELDS.map(([k]) => [k, settings[k] || '']))
  );
  const [sellerSaved, setSellerSaved] = useState(false);
  const setSellerField = (k) => (e) => setSeller({ ...seller, [k]: e.target.value });
  const [pdvObveznik, setPdvObveznik] = useState(!!settings.pdv_obveznik);
  const [pdvRate, setPdvRate] = useState(settings.pdv_rate ?? 20);
  const [pdvSaved, setPdvSaved] = useState(false);
  const [sellerEn, setSellerEn] = useState({
    ...Object.fromEntries(SELLER_EN_FIELDS.map(([k]) => [k, settings[k] || ''])),
    seller_entity_type: settings.seller_entity_type || 'individual',
    en_title_bilingual: settings.en_title_bilingual ? 1 : 0,
  });
  const [payout, setPayout] = useState(() => {
    const p = parsePayout(settings.payout_usd_json);
    return Object.fromEntries(PAYOUT_FIELDS.map(([k]) => [k, p[k] || '']));
  });
  const [enSaved, setEnSaved] = useState(false);
  const [enErr, setEnErr] = useState('');
  const [taxBasis, setTaxBasis] = useState(settings.tax_date_basis || 'paid_on');
  const routingBad = payout.routing_aba && !isValidAba(payout.routing_aba);

  async function save() {
    setErr(''); setSaved(false);
    try {
      await saveSettings({ eur_to_rsd: Number(rate) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setErr(e.message); }
  }

  async function saveSeller() {
    setErr(''); setSellerSaved(false);
    try {
      await saveSettings(seller);
      setSellerSaved(true);
      setTimeout(() => setSellerSaved(false), 2000);
    } catch (e) { setErr(e.message); }
  }

  async function savePdv() {
    setErr(''); setPdvSaved(false);
    try {
      await saveSettings({ pdv_obveznik: pdvObveznik ? 1 : 0, pdv_rate: Number(pdvRate) });
      setPdvSaved(true);
      setTimeout(() => setPdvSaved(false), 2000);
    } catch (e) { setErr(e.message); }
  }

  async function saveEnglish() {
    setEnErr(''); setEnSaved(false);
    try {
      await saveSettings({ ...sellerEn, payout_usd_json: JSON.stringify(payout) });
      setEnSaved(true);
      setTimeout(() => setEnSaved(false), 2000);
    } catch (e) { setEnErr(e.message); }
  }

  async function changeTaxBasis(v) {
    setTaxBasis(v);
    try { await saveSettings({ tax_date_basis: v }); } catch (e) { setErr(e.message); }
  }

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      projects: data.projects,
      charges: data.charges,
      payments: data.payments,
      overheads: data.overheads,
      overhead_payments: data.overhead_payments,
      invoices: data.invoices,
      transfers: data.transfers,
      leads: data.leads,
      settings: data.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Exchange rate and data backup</p>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Currency</h2>
          <p className="page-sub" style={{ marginTop: 0 }}>
            Every amount is stored in its own currency (EUR, USD or RSD). The RSD view converts
            <strong> EUR</strong> amounts by this rate; USD is never converted at today's rate.
          </p>
          <div className="field-row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>1 EUR = ? RSD</label>
              <input className="input" type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={save} style={{ marginBottom: 0 }}>Save</button>
          </div>
          {saved && <p className="inline-note" style={{ color: 'var(--color-vivid-green)' }}>Saved.</p>}
          {err && <div className="form-error" style={{ marginTop: 10 }}>{err}</div>}
          <p className="inline-note">Example: {formatMoney(100, 'EUR', { display_currency: 'RSD', eur_to_rsd: Number(rate) })} for €100.</p>
        </div>

        <div className="card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Backup</h2>
          <p className="page-sub" style={{ marginTop: 0 }}>
            Your data lives in <code style={{ fontFamily: 'var(--font-mono)' }}>payments.db</code> — copy that file to back up.
            You can also export a JSON snapshot.
          </p>
          <button className="btn" onClick={exportJson}>⬇ Export JSON snapshot</button>
        </div>
      </div>

      <h2 className="section-title">Business details (Prodavac)</h2>
      <div className="card">
        <p className="page-sub" style={{ marginTop: 0 }}>
          Printed on invoices as the seller. Filling <strong>PIB</strong> switches issued documents from
          <em> predračun</em> to <em>račun</em>.
        </p>
        {SELLER_FIELDS.map(([k, label, placeholder]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <input className="input" value={seller[k]} onChange={setSellerField(k)} placeholder={placeholder} />
          </div>
        ))}
        <button className="btn btn-primary" onClick={saveSeller}>Save business details</button>
        {sellerSaved && <p className="inline-note" style={{ color: 'var(--color-vivid-green)' }}>Saved.</p>}
        {err && <div className="form-error" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <h2 className="section-title">English invoices (US clients)</h2>
      <div className="card">
        <p className="page-sub" style={{ marginTop: 0 }}>
          Printed on English invoices. The payer's bank checks the beneficiary name and address against your
          Payoneer profile, so copy them <strong>character for character</strong>. These live only in your
          database — never in the repo.
        </p>
        {SELLER_EN_FIELDS.map(([k, label, placeholder, multi]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            {multi
              ? <textarea className="input" rows={3} value={sellerEn[k]} onChange={(e) => setSellerEn({ ...sellerEn, [k]: e.target.value })} placeholder={placeholder} />
              : <input className="input" value={sellerEn[k]} onChange={(e) => setSellerEn({ ...sellerEn, [k]: e.target.value })} placeholder={placeholder} />}
          </div>
        ))}
        {/[^\x20-\x7E]/.test(sellerEn.seller_name_en) && (
          <p className="inline-note" style={{ color: 'var(--color-tangerine)', marginTop: -6 }}>
            Name has non-ASCII characters — use exactly what Payoneer shows.
          </p>
        )}
        <div className="field">
          <label>Entity type</label>
          <select className="select" value={sellerEn.seller_entity_type} onChange={(e) => setSellerEn({ ...sellerEn, seller_entity_type: e.target.value })}>
            <option value="individual">Individual (frilenser) — clients get a W-8BEN</option>
            <option value="preduzetnik">Preduzetnik — clients get a W-8BEN</option>
            <option value="doo">DOO — clients get a W-8BEN-E</option>
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={!!sellerEn.en_title_bilingual}
            onChange={(e) => setSellerEn({ ...sellerEn, en_title_bilingual: e.target.checked ? 1 : 0 })} />
          <span>Also print the Serbian title (“INVOICE / RAČUN”) — only if your accountant says foreign invoices need it</span>
        </label>

        <h3 className="section-title" style={{ fontSize: 14 }}>USD receiving account</h3>
        <p className="inline-note" style={{ marginTop: 0 }}>
          Printed for US <strong>company</strong> clients only (ACH / domestic wire). Individuals get a Payoneer
          payment link instead. No SWIFT code is ever printed. Each invoice snapshots these at issue time.
        </p>
        {PAYOUT_FIELDS.map(([k, label, placeholder, multi]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            {multi
              ? <textarea className="input" rows={2} value={payout[k]} onChange={(e) => setPayout({ ...payout, [k]: e.target.value })} placeholder={placeholder} />
              : <input className="input" value={payout[k]} onChange={(e) => setPayout({ ...payout, [k]: e.target.value })} placeholder={placeholder} />}
          </div>
        ))}
        {routingBad && (
          <p className="inline-note" style={{ color: 'var(--color-tangerine)', marginTop: -6 }}>
            Not a valid ABA routing number — check for a mistyped digit.
          </p>
        )}
        <button className="btn btn-primary" onClick={saveEnglish} disabled={routingBad}>Save English details</button>
        {enSaved && <p className="inline-note" style={{ color: 'var(--color-vivid-green)' }}>Saved.</p>}
        {enErr && <div className="form-error" style={{ marginTop: 10 }}>{enErr}</div>}
      </div>

      <h2 className="section-title">Freelancer tax</h2>
      <div className="card">
        <p className="page-sub" style={{ marginTop: 0 }}>
          Which date puts a foreign payment into a quarter. Ask your accountant; switching only regroups the
          dashboard table — no payment data changes.
        </p>
        <select className="select" value={taxBasis} onChange={(e) => changeTaxBasis(e.target.value)}>
          <option value="paid_on">Paid-on date</option>
          <option value="received_on">Date credited in Payoneer (falls back to paid-on)</option>
        </select>
      </div>

      <h2 className="section-title">PDV (VAT)</h2>
      <div className="card">
        <p className="page-sub" style={{ marginTop: 0 }}>
          Turn this on <strong>only</strong> once you're actually in the PDV system (prometom preko
          praga ili dobrovoljno). While off, invoices carry no PDV and print as before. Past invoices
          keep the rate they were issued with — flipping this never changes them.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={pdvObveznik} onChange={(e) => setPdvObveznik(e.target.checked)} />
          <span>Obveznik PDV-a (u sistemu PDV-a)</span>
        </label>
        <div className="field-row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Opšta stopa PDV-a (%)</label>
            <input className="input" type="number" step="0.1" min="0" value={pdvRate}
              disabled={!pdvObveznik} onChange={(e) => setPdvRate(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={savePdv} style={{ marginBottom: 0 }}>Save PDV settings</button>
        </div>
        {pdvSaved && <p className="inline-note" style={{ color: 'var(--color-vivid-green)' }}>Saved.</p>}
      </div>
    </main>
  );
}
