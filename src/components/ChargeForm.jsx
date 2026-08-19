import { useState } from 'react';
import Modal from './Modal.jsx';
import { ADDONS, INCOME_CATEGORIES, EXPENSE_CATEGORIES, FREQUENCIES } from '../catalog.js';

const today = () => new Date().toISOString().slice(0, 10);

export default function ChargeForm({ initial, defaultDirection = 'income', onSubmit, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    direction: initial?.direction || defaultDirection,
    category: initial?.category || (defaultDirection === 'income' ? 'feature' : 'hosting'),
    label: initial?.label || '',
    amount: initial?.amount ?? '',
    frequency: initial?.frequency || 'one_time',
    next_due: initial?.next_due || today(),
    active: initial?.active ?? 1,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const categories = form.direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function applyAddon(a) {
    setForm((f) => ({
      ...f,
      direction: 'income',
      category: a.category,
      label: a.label,
      amount: a.amount || '',
      frequency: a.frequency,
      next_due: a.frequency === 'one_time' ? f.next_due : today(),
    }));
  }

  async function submit() {
    if (form.amount === '' || Number.isNaN(Number(form.amount))) {
      setError('Enter a valid amount.'); return;
    }
    setBusy(true); setError('');
    try {
      await onSubmit({
        ...form,
        amount: Number(form.amount),
        next_due: form.frequency === 'one_time' && Number(form.active) === 0 ? null : form.next_due || null,
        active: Number(form.active),
      });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title={isEdit ? 'Edit charge' : 'Add charge'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {isEdit ? 'Save' : 'Add charge'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      {!isEdit && (
        <div className="field">
          <label>Quick add — client add-on</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ADDONS.map((a) => (
              <button type="button" key={a.key} className="pill accent-violet" onClick={() => applyAddon(a)}>
                <span className="dot" />{a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label>Type</label>
          <select className="select" value={form.direction} onChange={(e) => {
            const dir = e.target.value;
            setForm((f) => ({ ...f, direction: dir, category: dir === 'income' ? 'feature' : 'hosting' }));
          }}>
            <option value="income">Income (client pays me)</option>
            <option value="expense">Expense (I pay)</option>
          </select>
        </div>
        <div className="field">
          <label>Category</label>
          <select className="select" value={form.category} onChange={set('category')}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Label</label>
        <input className="input" value={form.label} onChange={set('label')} placeholder="e.g. Monthly maintenance" />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Amount (EUR)</label>
          <input className="input" type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" />
        </div>
        <div className="field">
          <label>Frequency</label>
          <select className="select" value={form.frequency} onChange={set('frequency')}>
            {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {form.frequency !== 'one_time' && (
        <div className="field">
          <label>Next due date</label>
          <input type="date" className="input" value={form.next_due || ''} onChange={set('next_due')} />
        </div>
      )}
      {form.frequency === 'one_time' && (
        <div className="field">
          <label>Due date {isEdit ? '' : '(leave for expected one-time payment)'}</label>
          <input type="date" className="input" value={form.next_due || ''} onChange={set('next_due')} />
        </div>
      )}

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
        <input type="checkbox" checked={Number(form.active) === 1} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} />
        Active (counts toward scheduled payments &amp; MRR)
      </label>
    </Modal>
  );
}
