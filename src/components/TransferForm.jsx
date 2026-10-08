import { useState } from 'react';
import Modal from './Modal.jsx';
import { CURRENCIES, businessToday as today } from '../../server/money.js';

// Log a Payoneer → bank transfer: what left Payoneer (incl. its fees) and what
// actually arrived at the bank. NBS rates are looked up on save.
export default function TransferForm({ initial, onSubmit, onClose }) {
  const [form, setForm] = useState({
    transferred_on: initial?.transferred_on || today(),
    out_amount: initial?.out_amount ?? '',
    out_currency: initial?.out_currency || 'USD',
    in_amount: initial?.in_amount ?? '',
    in_currency: initial?.in_currency || 'EUR',
    note: initial?.note || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const rate = Number(form.in_amount) / Number(form.out_amount);

  async function submit() {
    setBusy(true); setError('');
    try {
      await onSubmit({ ...form, out_amount: Number(form.out_amount), in_amount: Number(form.in_amount) });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const curSelect = (k) => (
    <select className="select" style={{ width: 84 }} value={form[k]} onChange={set(k)}>
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );

  return (
    <Modal
      title={initial?.id ? 'Edit transfer' : 'Log transfer'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>Save</button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Date</label>
        <input className="input" type="date" value={form.transferred_on} onChange={set('transferred_on')} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Left Payoneer (incl. fees)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" type="number" step="0.01" min="0" value={form.out_amount} onChange={set('out_amount')} />
            {curSelect('out_currency')}
          </div>
        </div>
        <div className="field">
          <label>Arrived at the bank</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" type="number" step="0.01" min="0" value={form.in_amount} onChange={set('in_amount')} />
            {curSelect('in_currency')}
          </div>
        </div>
      </div>
      {rate > 0 && Number.isFinite(rate) && (
        <p className="inline-note" style={{ marginTop: 0 }}>Effective rate: 1 {form.out_currency} = {rate.toFixed(4)} {form.in_currency}</p>
      )}
      <div className="field">
        <label>Note</label>
        <input className="input" value={form.note} onChange={set('note')} placeholder="e.g. Payoneer → UniCredit" />
      </div>
    </Modal>
  );
}
