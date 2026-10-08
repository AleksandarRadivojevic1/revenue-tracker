import { useState } from 'react';
import Modal from './Modal.jsx';
import { PACKAGES, PACKAGE_BY_KEY, CUSTOM_PACKAGE, MAINTENANCE_TIERS } from '../catalog.js';
import { formatMoney, CURRENCY_LABEL } from '../format.js';
import { CURRENCIES, businessToday as today } from '../../server/money.js';

const COUNTRIES = ['RS', 'US', 'CA', 'GB', 'AU', 'DE', 'NL', 'SI', 'HR', 'BA', 'ME', 'MK'];

export default function ProjectForm({ initial, settings, onSubmit, onClose }) {
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({
    name: initial?.name || '',
    client: initial?.client || '',
    url: initial?.url || '',
    status: initial?.status || 'active',
    package: initial?.package || '',
    notes: initial?.notes || '',
    client_address: initial?.client_address || '',
    client_pib: initial?.client_pib || '',
    client_mb: initial?.client_mb || '',
    currency: initial?.currency || 'EUR',
    client_country: initial?.client_country || 'RS',
    client_type: initial?.client_type || 'company',
    client_legal_name: initial?.client_legal_name || '',
    client_contact: initial?.client_contact || '',
    client_email: initial?.client_email || '',
    sow_ref: initial?.sow_ref || '',
    w8ben_sent_on: initial?.w8ben_sent_on || '',
  });
  const isDomestic = form.client_country === 'RS';

  // A new project's currency follows the client's country (US → USD). On edit
  // it's left alone — existing charges keep their own currency regardless.
  function changeCountry(e) {
    const country = e.target.value.toUpperCase().slice(0, 2);
    const next = { ...form, client_country: country };
    if (!isEdit && country.length === 2) next.currency = country === 'US' ? 'USD' : 'EUR';
    setForm(next);
  }

  // new-project-only: auto-create build + maintenance charges
  const [addDefaults, setAddDefaults] = useState(true);
  const [buildAmount, setBuildAmount] = useState('');
  const [maintTier, setMaintTier] = useState('none'); // website | webapp | custom | none
  const [maintFreq, setMaintFreq] = useState('monthly');
  const [maintAmount, setMaintAmount] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  function selectPackage(key) {
    // toggle off if same
    if (form.package === key) { setForm({ ...form, package: '' }); return; }
    setForm({ ...form, package: key });
    if (key === CUSTOM_PACKAGE.key) {
      setBuildAmount('');
      setMaintTier('none');
      setMaintAmount('');
    } else {
      const p = PACKAGE_BY_KEY[key];
      setBuildAmount(String(p.build));
      setMaintTier(p.tier);
      setMaintFreq('monthly');
      setMaintAmount(String(MAINTENANCE_TIERS[p.tier].monthly));
    }
  }

  function changeMaintTier(tier) {
    setMaintTier(tier);
    if (tier === 'website' || tier === 'webapp') {
      setMaintAmount(String(MAINTENANCE_TIERS[tier][maintFreq]));
    } else if (tier === 'none') {
      setMaintAmount('');
    }
  }
  function changeMaintFreq(freq) {
    setMaintFreq(freq);
    if (maintTier === 'website' || maintTier === 'webapp') {
      setMaintAmount(String(MAINTENANCE_TIERS[maintTier][freq]));
    }
  }

  async function submit() {
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    setBusy(true); setError('');

    let autoCharges = null;
    if (!isEdit && form.package && addDefaults) {
      const build = Number(buildAmount);
      const maint = Number(maintAmount);
      autoCharges = {
        buildAmount: buildAmount !== '' && build > 0 ? build : null,
        maintenance: maintTier !== 'none' && maintAmount !== '' && maint > 0
          ? { amount: maint, freq: maintFreq, tierLabel: MAINTENANCE_TIERS[maintTier]?.label || 'Custom' }
          : null,
        startDate,
      };
    }

    try {
      await onSubmit(form, autoCharges);
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }

  const showDefaults = !isEdit && Boolean(form.package);
  const cur = form.currency;

  return (
    <Modal
      title={isEdit ? 'Edit project' : 'New project'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {isEdit ? 'Save' : 'Create project'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field-row">
        <div className="field">
          <label>Project / site name</label>
          <input className="input" value={form.name} onChange={set('name')} placeholder="Optika Cajs" autoFocus />
        </div>
        <div className="field">
          <label>Client</label>
          <input className="input" value={form.client} onChange={set('client')} placeholder="Client name" />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Client country</label>
          <input className="input" list="country-codes" value={form.client_country} onChange={changeCountry}
            maxLength={2} placeholder="RS" style={{ textTransform: 'uppercase' }} />
          <datalist id="country-codes">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div className="field">
          <label>Billing currency</label>
          <select className="select" value={form.currency} onChange={set('currency')}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label>Live URL</label>
          <input className="input" value={form.url} onChange={set('url')} placeholder="optikacajs.rs" />
        </div>
        <div className="field">
          <label>Status</label>
          <select className="select" value={form.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label>Package used</label>
        <div className="pkg-grid">
          {PACKAGES.map((p) => (
            <button type="button" key={p.key}
              className={`pkg-opt ${form.package === p.key ? 'selected' : ''}`}
              onClick={() => selectPackage(p.key)}>
              {p.popular && <span className="pill accent-blue best"><span className="dot" />Top</span>}
              <div className="pkg-name">{p.name}</div>
              <div className="pkg-tag">{p.tagline}</div>
              <div className="pkg-price">from {formatMoney(p.build, 'EUR', settings)}</div>
            </button>
          ))}
          <button type="button"
            className={`pkg-opt ${form.package === CUSTOM_PACKAGE.key ? 'selected' : ''}`}
            onClick={() => selectPackage(CUSTOM_PACKAGE.key)}
            style={{ gridColumn: '1 / -1' }}>
            <div className="pkg-name">{CUSTOM_PACKAGE.name} deal</div>
            <div className="pkg-tag">Set your own build price and maintenance</div>
          </button>
        </div>
      </div>

      {showDefaults && (
        <div className="card" style={{ background: 'var(--color-paper-mist)', border: 'none' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
            <input type="checkbox" checked={addDefaults} onChange={(e) => setAddDefaults(e.target.checked)} />
            Auto-add these charges to the project
          </label>

          {addDefaults && (
            <>
              <div className="field-row" style={{ marginTop: 12 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Build amount ({cur})</label>
                  <input className="input" type="number" step="0.01" min="0" value={buildAmount}
                    onChange={(e) => setBuildAmount(e.target.value)} placeholder="e.g. 900 — leave empty to skip" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Start / launch date</label>
                  <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>

              <div className="field-row" style={{ marginTop: 12 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Maintenance</label>
                  <select className="select" value={maintTier} onChange={(e) => changeMaintTier(e.target.value)}>
                    <option value="none">None</option>
                    <option value="website">Website tier</option>
                    <option value="webapp">Web app tier</option>
                    <option value="custom">Custom amount</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Billing</label>
                  <select className="select" value={maintFreq} onChange={(e) => changeMaintFreq(e.target.value)} disabled={maintTier === 'none'}>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Amount ({cur})</label>
                  <input className="input" type="number" step="0.01" min="0" value={maintAmount}
                    onChange={(e) => setMaintAmount(e.target.value)} disabled={maintTier === 'none'} placeholder="0" />
                </div>
              </div>
              <p className="inline-note">
                Build is a one-time charge due on the launch date. Maintenance first-due is one month after launch.
                Everything is editable afterwards.
              </p>
            </>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 14 }}>
        <label>Notes</label>
        <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
      </div>

      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--color-steel)' }}>
          Billing details (for invoices)
        </summary>
        <div style={{ marginTop: 12 }}>
          {!isDomestic && (
            <>
              <div className="field-row">
                <div className="field">
                  <label>Client type</label>
                  <select className="select" value={form.client_type} onChange={set('client_type')}>
                    <option value="company">Company (pays from a business account)</option>
                    <option value="individual">Individual (pays via Payoneer link)</option>
                  </select>
                </div>
                <div className="field">
                  <label>Legal name (bill the entity)</label>
                  <input className="input" value={form.client_legal_name} onChange={set('client_legal_name')} placeholder="Smith Kitchen & Bath LLC" />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Contact person</label>
                  <input className="input" value={form.client_contact} onChange={set('client_contact')} placeholder="John Smith" />
                </div>
                <div className="field">
                  <label>Billing email</label>
                  <input className="input" type="email" value={form.client_email} onChange={set('client_email')} placeholder="ap@client.com" />
                </div>
              </div>
            </>
          )}
          <div className="field">
            <label>Client address</label>
            <textarea className="input" rows={isDomestic ? 2 : 3} value={form.client_address} onChange={set('client_address')}
              placeholder={isDomestic ? 'Ulica i broj\nGrad' : '123 Main St\nColumbus, OH 43004'} />
          </div>
          {isDomestic ? (
            <div className="field-row">
              <div className="field">
                <label>PIB</label>
                <input className="input" value={form.client_pib} onChange={set('client_pib')} placeholder="9 cifara" />
              </div>
              <div className="field">
                <label>Matični broj (MB)</label>
                <input className="input" value={form.client_mb} onChange={set('client_mb')} placeholder="8 cifara" />
              </div>
            </div>
          ) : (
            <div className="field-row">
              <div className="field">
                <label>SOW reference</label>
                <input className="input" value={form.sow_ref} onChange={set('sow_ref')} placeholder="e.g. SKB-01" />
              </div>
              <div className="field">
                <label>W-8BEN sent on</label>
                <input className="input" type="date" value={form.w8ben_sent_on || ''} onChange={set('w8ben_sent_on')} />
              </div>
            </div>
          )}
        </div>
      </details>
    </Modal>
  );
}
