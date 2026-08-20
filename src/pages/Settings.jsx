import { useState } from 'react';
import { formatMoney } from '../format.js';

export default function Settings({ data, saveSettings }) {
  const { settings } = data;
  const [rate, setRate] = useState(settings.eur_to_rsd);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr(''); setSaved(false);
    try {
      await saveSettings({ eur_to_rsd: Number(rate) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
    </main>
  );
}
