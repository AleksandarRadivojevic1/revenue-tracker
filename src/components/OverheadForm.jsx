import { useState } from 'react';
import Modal from './Modal.jsx';
import { OVERHEAD_CATEGORIES, OVERHEAD_PRESETS, FREQUENCIES } from '../catalog.js';

const today = () => new Date().toISOString().slice(0, 10);

export default function OverheadForm({ initial, onSubmit, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    label: initial?.label || '',
    category: initial?.category || 'tool',
    amount: initial?.amount ?? '',
    frequency: initial?.frequency || 'monthly',
    next_due: initial?.next_due || today(),
    active: initial?.active ?? 1,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function applyPreset(p) {
    setForm((f) => ({
      ...f,
      label: p.label,
      category: p.category,
      amount: p.amount || '',
      frequency: p.frequency,
      next_due: p.frequency === 'one_time' ? f.next_due : today(),
    }));
  }

  async function submit() {
    if (!form.label.trim()) { setError('Enter a name.'); return; }
    if (form.amount === '' || Number.isNaN(Number(form.amount))) {
      setError('Enter a valid amount.'); return;
    }
    setBusy(true); setError('');
    try {
      await onSubmit({
        ...form,
        label: form.label.trim(),
        amount: Number(form.amount),
        next_due: form.frequency === 'one_time' && Number(form.active) === 0 ? null : form.next_due || null,
        active: Number(form.active),
      });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal
      title={isEdit ? 'Edit cost' : 'Add cost'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {isEdit ? 'Save' : 'Add cost'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      {!isEdit && (
        <div className="field">
          <label>Quick add</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {OVERHEAD_PRESETS.map((p) => (
              <button type="button" key={p.key} className="pill accent-orange" onClick={() => applyPreset(p)}>
                <span className="dot" />{p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>Name</label>
        <input className="input" value={form.label} onChange={set('label')} placeholder="e.g. Claude Code subscription" />
      </div>

      <div className="field-row">
        <div className="field">
          <label>Category</label>
          <select className="select" value={form.category} onChange={set('category')}>
            {OVERHEAD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Amount (EUR)</label>
          <input className="input" type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Frequency</label>
          <select className="select" value={form.frequency} onChange={set('frequency')}>
            {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{form.frequency === 'one_time' ? 'Due date' : 'Next due date'}</label>
          <input type="date" className="input" value={form.next_due || ''} onChange={set('next_due')} />
        </div>
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
        <input type="checkbox" checked={Number(form.active) === 1} onChange={(e) => setForm({ ...form, active: e.target.checked ? 1 : 0 })} />
        Active (counts toward scheduled &amp; recurring costs)
      </label>
    </Modal>
  );
}
