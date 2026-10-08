import { useState } from 'react';
import Modal from './Modal.jsx';
import { CURRENCIES, paymentRsd } from '../../server/money.js';
import { formatMoney } from '../format.js';

export const CHANNELS = [
  ['payoneer_receiving_ach', 'Payoneer receiving account (ACH / wire)'],
  ['payoneer_request_ach', 'Payoneer payment request — ACH debit'],
  ['payoneer_request_card', 'Payoneer payment request — card'],
  ['domestic', 'Domestic (Serbian payer)'],
];

// Edit an existing ledger payment. The project, direction and originating
// charge are fixed — those aren't things you "fix" on a payment. Amount,
// currency, dates and the tax fields are, since they feed the tax base.
export default function PaymentForm({ initial, onSubmit, onClose }) {
  const [form, setForm] = useState({
    amount: initial?.amount ?? '',
    currency: initial?.currency || 'EUR',
    paid_on: initial?.paid_on || '',
    received_on: initial?.received_on || '',
    channel: initial?.channel || '',
    fee: initial?.fee || '',
    nbs_rate_rsd: initial?.nbs_rate_rsd ?? '',
    note: initial?.note || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isIncome = initial?.direction !== 'expense';
  const needsRate = form.currency !== 'RSD';
  const rsd = paymentRsd({ amount: Number(form.amount), currency: form.currency, nbs_rate_rsd: Number(form.nbs_rate_rsd) });

  async function submit() {
    if (form.amount === '' || Number.isNaN(Number(form.amount))) {
      setError('Enter a valid amount.'); return;
    }
    setBusy(true); setError('');
    try {
      await onSubmit({
        ...form,
        amount: Number(form.amount),
        fee: Number(form.fee) || 0,
        nbs_rate_rsd: form.nbs_rate_rsd === '' ? null : Number(form.nbs_rate_rsd),
        received_on: form.received_on || null,
        channel: form.channel || null,
      });
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
          <label>Amount — gross, before fees ({form.currency})</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" />
            <select className="select" style={{ width: 84 }} value={form.currency} onChange={set('currency')} title="Currency">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label>Paid on</label>
          <input className="input" type="date" value={form.paid_on || ''} onChange={set('paid_on')} />
        </div>
      </div>

      {isIncome && (
        <>
          <div className="field-row">
            <div className="field">
              <label>Channel</label>
              <select className="select" value={form.channel} onChange={set('channel')}>
                <option value="">— (treated as domestic)</option>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Credited in Payoneer on</label>
              <input className="input" type="date" value={form.received_on || ''} onChange={set('received_on')} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Processor fee ({form.currency})</label>
              <input className="input" type="number" step="0.01" min="0" value={form.fee} onChange={set('fee')} placeholder="0.00" />
            </div>
            <div className="field">
              <label>NBS middle rate (1 {form.currency} = ? RSD)</label>
              <input className="input" type="number" step="0.0001" min="0" value={needsRate ? form.nbs_rate_rsd : 1}
                disabled={!needsRate} onChange={set('nbs_rate_rsd')} placeholder="from nbs.rs for the payment date" />
            </div>
          </div>
          <p className="inline-note" style={{ marginTop: 0 }}>
            Tax base: {rsd == null ? 'enter the NBS rate for this date' : formatMoney(rsd, 'RSD')}
          </p>
        </>
      )}

      <div className="field">
        <label>Note</label>
        <input className="input" value={form.note} onChange={set('note')} placeholder="Optional note" />
      </div>
    </Modal>
  );
}
