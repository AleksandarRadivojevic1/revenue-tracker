import { useState } from 'react';
import Modal from './Modal.jsx';

// Edit an existing ledger payment: amount, date, note. The project, direction
// and originating charge are fixed — those aren't things you "fix" on a payment.
export default function PaymentForm({ initial, onSubmit, onClose }) {
  const [form, setForm] = useState({
    amount: initial?.amount ?? '',
    paid_on: initial?.paid_on || '',
    note: initial?.note || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit() {
    if (form.amount === '' || Number.isNaN(Number(form.amount))) {
      setError('Enter a valid amount.'); return;
    }
    setBusy(true); setError('');
    try {
      await onSubmit({ ...form, amount: Number(form.amount) });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title="Edit payment"
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
        <div className="field">
          <label>Amount (EUR)</label>
          <input className="input" type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" />
        </div>
        <div className="field">
          <label>Paid on</label>
          <input className="input" type="date" value={form.paid_on || ''} onChange={set('paid_on')} />
        </div>
      </div>
      <div className="field">
        <label>Note</label>
        <input className="input" value={form.note} onChange={set('note')} placeholder="Optional note" />
      </div>
    </Modal>
  );
}
