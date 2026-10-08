import { useState } from 'react';
import Modal from './Modal.jsx';
import { businessToday as today, chargePaidSoFar, chargeRemaining, currencyOf } from '../../server/money.js';
import { formatMoney } from '../format.js';

// Pay a charge in full or in part (e.g. a 50% deposit). The charge only
// closes / rolls to its next period once the current period is fully paid.
export default function ChargePayForm({ charge, payments, settings, onSubmit, onClose }) {
  const cur = currencyOf(charge);
  const paid = chargePaidSoFar(charge, payments);
  const remaining = chargeRemaining(charge, payments);
  const [amount, setAmount] = useState(remaining);
  const [paidOn, setPaidOn] = useState(today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const partial = Number(amount) < remaining - 0.005;

  async function submit() {
    setBusy(true); setError('');
    try { await onSubmit({ amount: Number(amount), paid_on: paidOn }); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title={`Pay: ${charge.label || charge.category}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{partial ? 'Log part payment' : 'Mark paid'}</button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="kv"><span className="k">Charge</span><span className="v">{formatMoney(charge.amount, cur, settings)}</span></div>
      {paid > 0 && <div className="kv"><span className="k">Paid so far</span><span className="v">{formatMoney(paid, cur, settings)}</span></div>}
      <div className="kv" style={{ marginBottom: 12 }}><span className="k">Left</span><span className="v blue">{formatMoney(remaining, cur, settings)}</span></div>
      <div className="field-row">
        <div className="field">
          <label>Amount ({cur})</label>
          <input className="input" type="number" step="0.01" min="0" max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label>Paid on</label>
          <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
      </div>
      <p className="inline-note">
        {partial
          ? `A part payment — the charge stays open until the remaining ${formatMoney(remaining - Number(amount), cur, settings)} is paid.`
          : charge.frequency === 'one_time' ? 'This closes the charge.' : 'This completes the period and moves the charge to its next due date.'}
      </p>
    </Modal>
  );
}
