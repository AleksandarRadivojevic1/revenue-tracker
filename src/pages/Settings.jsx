import { useState } from 'react';
import { formatMoney } from '../format.js';

const SELLER_FIELDS = [
  ['seller_name', 'Naziv (ime / firma)', 'Aleksandar Radivojević PR'],
  ['seller_address', 'Adresa', 'Ulica i broj, grad'],
  ['seller_pib', 'PIB', '9 cifara — postavlja se → računi'],
  ['seller_mb', 'Matični broj (MB)', '8 cifara'],
  ['seller_bank', 'Tekući račun', '160-0000000000000-00'],
  ['seller_note', 'Napomena (podrazumevana)', 'Optional default note'],
];

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

  function exportJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      projects: data.projects,
      charges: data.charges,
      payments: data.payments,
      overheads: data.overheads,
      overhead_payments: data.overhead_payments,
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
            All amounts are stored in <strong>EUR</strong>. The RSD view multiplies by this rate.
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
          <p className="inline-note">Example: {formatMoney(100, { display_currency: 'RSD', eur_to_rsd: Number(rate) })} for €100.</p>
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
