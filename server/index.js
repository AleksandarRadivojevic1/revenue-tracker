import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from './db.js';
import {
  CURRENCIES, advanceDueDate, businessToday, dueDateFor, invoiceItemAmount, invoiceItemUnit,
  invoiceTotals, isValidAba, nextInvoiceNumber,
} from './money.js';
import { basicAuth } from './auth.js';
import { scheduleBackups } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Gate everything (API + static UI) behind Basic Auth when a password is set.
app.use(basicAuth());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const today = () => businessToday(); // Belgrade date — the container is TZ=UTC

// --- helpers ---------------------------------------------------------------
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

function readSettings() {
  return get('SELECT * FROM settings WHERE id = 1');
}

const VALID_CUR = new Set(CURRENCIES);
function checkCurrency(c) {
  if (!VALID_CUR.has(c)) throw new Error(`currency must be one of ${CURRENCIES.join(', ')}`);
  return c;
}

const VALID_CHANNEL = new Set(['payoneer_receiving_ach', 'payoneer_request_ach', 'payoneer_request_card', 'domestic']);

// How a project's client usually pays: domestic clients by bank transfer; a US
// company into the Payoneer receiving account; a US individual via a Payoneer
// payment request (the receiving account declines personal-account transfers).
function defaultChannel(project) {
  if (!project || (project.client_country || 'RS') === 'RS') return 'domestic';
  return project.client_type === 'individual' ? 'payoneer_request_ach' : 'payoneer_receiving_ach';
}

// Tax fields on a payment: RSD needs no rate; otherwise amount_rsd is gross ×
// the payment's own NBS rate, snapshotted (null until a rate is entered).
function paymentTax(amount, currency, rate) {
  if (currency === 'RSD') return { nbs_rate_rsd: 1, amount_rsd: amount };
  const r = Number(rate) || 0;
  return r > 0
    ? { nbs_rate_rsd: r, amount_rsd: Math.round(amount * r * 100) / 100 }
    : { nbs_rate_rsd: null, amount_rsd: null };
}

// wrap handlers so thrown errors become 400s instead of crashing the process
const h = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
};

// --- bootstrap (single load) ----------------------------------------------
app.get('/api/bootstrap', h((_req, res) => {
  res.json({
    projects: all('SELECT * FROM projects ORDER BY created_at DESC, id DESC'),
    charges: all('SELECT * FROM charges ORDER BY id DESC'),
    payments: all('SELECT * FROM payments ORDER BY paid_on DESC, id DESC'),
    overheads: all('SELECT * FROM overheads ORDER BY id DESC'),
    overhead_payments: all('SELECT * FROM overhead_payments ORDER BY paid_on DESC, id DESC'),
    invoices: all('SELECT * FROM invoices ORDER BY created_at DESC, id DESC'),
    settings: readSettings(),
    today: today(),
  });
}));

// --- projects --------------------------------------------------------------
app.get('/api/projects', h((_req, res) => {
  res.json(all('SELECT * FROM projects ORDER BY created_at DESC, id DESC'));
}));

// Editable project columns and their defaults for a new row.
const PROJECT_FIELDS = {
  client: '', url: '', status: 'active', package: '', notes: '',
  client_address: '', client_pib: '', client_mb: '',
  currency: 'EUR', client_country: 'RS', client_type: 'company', client_legal_name: '',
  client_contact: '', client_email: '', sow_ref: '', w8ben_sent_on: null,
};

function cleanProject(m) {
  if (!m.name || !String(m.name).trim()) throw new Error('name is required');
  checkCurrency(m.currency);
  if (!['company', 'individual'].includes(m.client_type)) throw new Error('client_type must be company or individual');
  const country = String(m.client_country || 'RS').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('client_country must be a 2-letter ISO code');
  return { ...m, name: String(m.name).trim(), client_country: country, w8ben_sent_on: m.w8ben_sent_on || null };
}

app.post('/api/projects', h((req, res) => {
  const m = cleanProject({ ...PROJECT_FIELDS, ...req.body });
  const cols = ['name', ...Object.keys(PROJECT_FIELDS)];
  const info = run(
    `INSERT INTO projects (${cols.join(', ')}, created_at) VALUES (${cols.map(() => '?').join(', ')}, ?)`,
    ...cols.map((c) => m[c]), today()
  );
  res.status(201).json(get('SELECT * FROM projects WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/projects/:id', h((req, res) => {
  const existing = get('SELECT * FROM projects WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('project not found');
  const m = cleanProject({ ...existing, ...req.body });
  const cols = ['name', ...Object.keys(PROJECT_FIELDS)];
  run(
    `UPDATE projects SET ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`,
    ...cols.map((c) => m[c]), existing.id
  );
  res.json(get('SELECT * FROM projects WHERE id = ?', existing.id));
}));

app.delete('/api/projects/:id', h((req, res) => {
  run('DELETE FROM projects WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// --- charges ---------------------------------------------------------------
const VALID_FREQ = new Set(['one_time', 'monthly', 'yearly']);
const VALID_DIR = new Set(['income', 'expense']);

app.post('/api/charges', h((req, res) => {
  const {
    project_id,
    direction,
    category = 'other',
    label = '',
    amount = 0,
    frequency = 'one_time',
    next_due = null,
    active = 1,
  } = req.body;
  const project = get('SELECT * FROM projects WHERE id = ?', project_id);
  if (!project) throw new Error('invalid project_id');
  if (!VALID_DIR.has(direction)) throw new Error('direction must be income or expense');
  if (!VALID_FREQ.has(frequency)) throw new Error('invalid frequency');
  if (Number.isNaN(Number(amount))) throw new Error('amount must be a number');
  // A charge is in its project's currency unless stated otherwise.
  const currency = checkCurrency(req.body.currency || project.currency || 'EUR');
  const info = run(
    `INSERT INTO charges (project_id, direction, category, label, amount, currency, frequency, next_due, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    project_id, direction, category, label, Number(amount), currency, frequency,
    next_due || null, active ? 1 : 0, today()
  );
  res.status(201).json(get('SELECT * FROM charges WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/charges/:id', h((req, res) => {
  const existing = get('SELECT * FROM charges WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('charge not found');
  const merged = { ...existing, ...req.body };
  if (!VALID_DIR.has(merged.direction)) throw new Error('direction must be income or expense');
  if (!VALID_FREQ.has(merged.frequency)) throw new Error('invalid frequency');
  checkCurrency(merged.currency || 'EUR');
  run(
    `UPDATE charges SET direction=?, category=?, label=?, amount=?, currency=?, frequency=?, next_due=?, active=? WHERE id=?`,
    merged.direction, merged.category, merged.label, Number(merged.amount), merged.currency || 'EUR',
    merged.frequency, merged.next_due || null, merged.active ? 1 : 0, existing.id
  );
  res.json(get('SELECT * FROM charges WHERE id = ?', existing.id));
}));

app.delete('/api/charges/:id', h((req, res) => {
  run('DELETE FROM charges WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// Mark a charge paid: log a payment, then advance/close the schedule.
app.post('/api/charges/:id/pay', h((req, res) => {
  const charge = get('SELECT * FROM charges WHERE id = ?', Number(req.params.id));
  if (!charge) throw new Error('charge not found');
  const paidOn = req.body?.paid_on || today();
  const project = get('SELECT * FROM projects WHERE id = ?', charge.project_id);
  const currency = charge.currency || 'EUR';
  const tax = paymentTax(charge.amount, currency, null);

  db.exec('BEGIN');
  try {
    run(
      `INSERT INTO payments (charge_id, project_id, direction, amount, currency, paid_on, note, channel, nbs_rate_rsd, amount_rsd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      charge.id, charge.project_id, charge.direction, charge.amount, currency, paidOn,
      req.body?.note || `Paid: ${charge.label || charge.category}`,
      charge.direction === 'income' ? defaultChannel(project) : null, tax.nbs_rate_rsd, tax.amount_rsd
    );

    if (charge.frequency === 'one_time') {
      run('UPDATE charges SET active = 0, next_due = NULL WHERE id = ?', charge.id);
    } else {
      const base = charge.next_due || paidOn;
      const next = advanceDueDate(base, charge.frequency);
      run('UPDATE charges SET next_due = ? WHERE id = ?', next, charge.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({
    charge: get('SELECT * FROM charges WHERE id = ?', charge.id),
    payment: get('SELECT * FROM payments WHERE project_id = ? ORDER BY id DESC LIMIT 1', charge.project_id),
  });
}));

// --- payments (manual ledger entries) -------------------------------------
function checkChannel(c) {
  if (c && !VALID_CHANNEL.has(c)) throw new Error('invalid payment channel');
  return c || null;
}

app.post('/api/payments', h((req, res) => {
  const { project_id, direction, amount, paid_on = today(), note = '', charge_id = null } = req.body;
  const project = get('SELECT * FROM projects WHERE id = ?', project_id);
  if (!project) throw new Error('invalid project_id');
  if (!VALID_DIR.has(direction)) throw new Error('direction must be income or expense');
  const currency = checkCurrency(req.body.currency || project.currency || 'EUR');
  const channel = checkChannel(req.body.channel || (direction === 'income' ? defaultChannel(project) : null));
  const tax = paymentTax(Number(amount), currency, req.body.nbs_rate_rsd);
  const info = run(
    `INSERT INTO payments (charge_id, project_id, direction, amount, currency, paid_on, note,
       received_on, channel, fee, nbs_rate_rsd, amount_rsd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    charge_id, project_id, direction, Number(amount), currency, paid_on, note,
    req.body.received_on || null, channel, Number(req.body.fee) || 0, tax.nbs_rate_rsd, tax.amount_rsd
  );
  res.status(201).json(get('SELECT * FROM payments WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/payments/:id', h((req, res) => {
  const existing = get('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('payment not found');
  const merged = { ...existing, ...req.body };
  if (Number.isNaN(Number(merged.amount))) throw new Error('amount must be a number');
  if (Number(merged.fee) < 0) throw new Error('fee cannot be negative');
  const currency = checkCurrency(merged.currency || 'EUR');
  const tax = paymentTax(Number(merged.amount), currency, merged.nbs_rate_rsd);
  // project_id, direction and charge_id are fixed — everything else is a
  // correction you may need to make (amount, currency, dates, tax fields).
  run(
    `UPDATE payments SET amount=?, currency=?, paid_on=?, note=?, received_on=?, channel=?, fee=?,
       nbs_rate_rsd=?, amount_rsd=? WHERE id=?`,
    Number(merged.amount), currency, merged.paid_on || existing.paid_on, merged.note ?? existing.note,
    merged.received_on || null, checkChannel(merged.channel), Number(merged.fee) || 0,
    tax.nbs_rate_rsd, tax.amount_rsd, existing.id
  );
  res.json(get('SELECT * FROM payments WHERE id = ?', existing.id));
}));

app.delete('/api/payments/:id', h((req, res) => {
  run('DELETE FROM payments WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// --- overheads (out-of-project costs) --------------------------------------
app.post('/api/overheads', h((req, res) => {
  const { label = '', category = 'tool', amount = 0, frequency = 'monthly', next_due = null, active = 1 } = req.body;
  if (!label || !label.trim()) throw new Error('label is required');
  if (!VALID_FREQ.has(frequency)) throw new Error('invalid frequency');
  if (Number.isNaN(Number(amount))) throw new Error('amount must be a number');
  const currency = checkCurrency(req.body.currency || 'EUR');
  const info = run(
    `INSERT INTO overheads (label, category, amount, currency, frequency, next_due, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    label.trim(), category, Number(amount), currency, frequency, next_due || null, active ? 1 : 0, today()
  );
  res.status(201).json(get('SELECT * FROM overheads WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/overheads/:id', h((req, res) => {
  const existing = get('SELECT * FROM overheads WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('overhead not found');
  const merged = { ...existing, ...req.body };
  if (!merged.label || !String(merged.label).trim()) throw new Error('label is required');
  if (!VALID_FREQ.has(merged.frequency)) throw new Error('invalid frequency');
  checkCurrency(merged.currency || 'EUR');
  run(
    `UPDATE overheads SET label=?, category=?, amount=?, currency=?, frequency=?, next_due=?, active=? WHERE id=?`,
    String(merged.label).trim(), merged.category, Number(merged.amount), merged.currency || 'EUR',
    merged.frequency, merged.next_due || null, merged.active ? 1 : 0, existing.id
  );
  res.json(get('SELECT * FROM overheads WHERE id = ?', existing.id));
}));

app.delete('/api/overheads/:id', h((req, res) => {
  run('DELETE FROM overheads WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// Mark an overhead paid: log a realized expense, then advance/close the schedule.
app.post('/api/overheads/:id/pay', h((req, res) => {
  const overhead = get('SELECT * FROM overheads WHERE id = ?', Number(req.params.id));
  if (!overhead) throw new Error('overhead not found');
  const paidOn = req.body?.paid_on || today();

  db.exec('BEGIN');
  try {
    run(
      `INSERT INTO overhead_payments (overhead_id, amount, currency, paid_on, note)
       VALUES (?, ?, ?, ?, ?)`,
      overhead.id, overhead.amount, overhead.currency || 'EUR', paidOn, req.body?.note || `Paid: ${overhead.label}`
    );

    if (overhead.frequency === 'one_time') {
      run('UPDATE overheads SET active = 0, next_due = NULL WHERE id = ?', overhead.id);
    } else {
      const base = overhead.next_due || paidOn;
      run('UPDATE overheads SET next_due = ? WHERE id = ?', advanceDueDate(base, overhead.frequency), overhead.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  res.json({
    overhead: get('SELECT * FROM overheads WHERE id = ?', overhead.id),
    payment: get('SELECT * FROM overhead_payments ORDER BY id DESC LIMIT 1'),
  });
}));

app.delete('/api/overhead-payments/:id', h((req, res) => {
  run('DELETE FROM overhead_payments WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
}));

// --- invoices --------------------------------------------------------------
const VALID_DISPLAY = new Set(['RSD', 'EUR', 'BOTH']);      // display modes of a EUR document
const VALID_TERMS = new Set(['Due on receipt', 'Net 7', 'Net 14']);
const VALID_STAGE = new Set(['full', 'deposit', 'balance']);
const PAYOUT_FIELDS = ['bank_name', 'bank_address', 'routing_aba', 'account_number', 'account_type', 'beneficiary_name', 'beneficiary_address'];

const parseJson = (s, fallback) => { try { return JSON.parse(s || ''); } catch { return fallback; } };

app.post('/api/invoices', h((req, res) => {
  const { project_id, supply_date = null, place = '', note = '', items = [], pdv_exempt = false } = req.body;
  const project = get('SELECT * FROM projects WHERE id = ?', project_id);
  if (!project) throw new Error('invalid project_id');

  const docCurrency = checkCurrency(req.body.doc_currency || project.currency || 'EUR');
  // Language follows the client's country unless chosen explicitly.
  const lang = req.body.lang || ((project.client_country || 'RS') === 'RS' ? 'sr' : 'en');
  if (!['sr', 'en'].includes(lang)) throw new Error("lang must be 'sr' or 'en'");
  // RSD/EUR/BOTH only means something for a Serbian EUR document; anything
  // else prints in its own currency with no conversion and no rate line.
  let currency = req.body.currency || 'RSD';
  if (docCurrency !== 'EUR') currency = docCurrency;
  else if (lang === 'en') currency = 'EUR';
  else if (!VALID_DISPLAY.has(currency)) throw new Error('currency must be RSD, EUR or BOTH');

  const terms = lang === 'en' ? (req.body.terms || 'Due on receipt') : '';
  if (terms && !VALID_TERMS.has(terms)) throw new Error('terms must be Due on receipt, Net 7 or Net 14');
  const stage = lang === 'en' ? (req.body.stage || 'full') : 'full';
  if (!VALID_STAGE.has(stage)) throw new Error('stage must be full, deposit or balance');
  const depositRef = stage === 'balance' ? String(req.body.deposit_ref || '').trim() : '';

  const cleanItems = (Array.isArray(items) ? items : []).map((i) => ({
    description: String(i.description || '').trim(),
    qty: Number(i.qty) || 0,
    unit: invoiceItemUnit(i),
    amount: invoiceItemAmount(i),
  }));
  if (cleanItems.length === 0) throw new Error('at least one line item is required');
  if (cleanItems.some((i) => !i.description)) throw new Error('every line item needs a description');

  const s = readSettings();
  const seller = {
    name: s.seller_name, address: s.seller_address, pib: s.seller_pib,
    mb: s.seller_mb, bank: s.seller_bank, note: s.seller_note,
    name_en: s.seller_name_en, brand: s.seller_brand, address_en: s.seller_address_en,
    email: s.seller_email, phone: s.seller_phone, entity_type: s.seller_entity_type,
  };
  const clientType = project.client_type || 'company';
  // A USD invoice carries the receiving-account details as of today. Snapshotted
  // only onto USD documents, so account numbers don't spread to every row.
  if (docCurrency === 'USD') {
    const payout = parseJson(s.payout_usd_json, {});
    if (clientType === 'company' && !(payout.routing_aba && payout.account_number)) {
      throw new Error('add the USD payout account (routing + account number) in Settings before invoicing a US company');
    }
    seller.payout_usd = Object.fromEntries(PAYOUT_FIELDS.map((k) => [k, payout[k] || '']));
  }
  const buyer = {
    name: project.client_legal_name || project.client || project.name, project: project.name,
    address: project.client_address, pib: project.client_pib, mb: project.client_mb,
    country: project.client_country || 'RS', type: clientType,
    legal_name: project.client_legal_name, contact: project.client_contact,
    email: project.client_email, sow_ref: project.sow_ref,
  };
  // A racun requires a registered issuer (PIB); until then it is a predracun.
  const kind = seller.pib && seller.pib.trim() ? 'racun' : 'predracun';

  // PDV applies only when in the PDV system AND the invoice isn't exempt
  // (foreign client / izvoz usluga). Rate + totals are snapshotted onto the row.
  const exempt = !!pdv_exempt;
  const pdvRate = s.pdv_obveznik && !exempt ? (Number(s.pdv_rate) || 0) : 0;
  const { subtotal, pdv, total } = invoiceTotals(cleanItems, pdvRate);
  // The legacy *_eur columns stay meaningful only for EUR documents.
  const eur = docCurrency === 'EUR';

  const issued = today();
  // Every number ever issued, void ones included — numbers are never reused.
  const existing = all('SELECT number FROM invoices').map((r) => r.number);
  const number = nextInvoiceNumber(existing, issued.slice(0, 4));

  const info = run(
    `INSERT INTO invoices
       (number, kind, project_id, issued_on, supply_date, place, currency, eur_to_rsd,
        seller_json, buyer_json, items_json, subtotal_eur, pdv_rate, pdv_eur, total_eur,
        pdv_exempt, note, created_at,
        doc_currency, lang, subtotal, pdv, total, due_on, terms, stage, deposit_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued')`,
    number, kind, project.id, issued, supply_date || issued, lang === 'en' ? '' : place, currency,
    eur ? Number(s.eur_to_rsd) || 0 : 0,
    JSON.stringify(seller), JSON.stringify(buyer), JSON.stringify(cleanItems),
    eur ? subtotal : 0, pdvRate, eur ? pdv : 0, eur ? total : 0, exempt ? 1 : 0, note, issued,
    docCurrency, lang, subtotal, pdv, total, terms ? dueDateFor(issued, terms) : null, terms, stage, depositRef
  );
  res.status(201).json(get('SELECT * FROM invoices WHERE id = ?', info.lastInsertRowid));
}));

// Invoices are never deleted — a client may already hold the number. Voiding
// keeps the row and its number, stamps the PDF VOID and drops it from totals.
app.post('/api/invoices/:id/void', h((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', Number(req.params.id));
  if (!inv) throw new Error('invoice not found');
  run("UPDATE invoices SET status = 'void' WHERE id = ?", inv.id);
  res.json(get('SELECT * FROM invoices WHERE id = ?', inv.id));
}));

// --- settings --------------------------------------------------------------
app.put('/api/settings', h((req, res) => {
  const cur = readSettings();
  const m = { ...cur, ...req.body };
  if (Number(m.eur_to_rsd) <= 0) throw new Error('eur_to_rsd must be positive');
  if (Number(m.pdv_rate) < 0) throw new Error('pdv_rate cannot be negative');
  if (!['individual', 'preduzetnik', 'doo'].includes(m.seller_entity_type)) throw new Error('invalid seller_entity_type');
  if (!['paid_on', 'received_on'].includes(m.tax_date_basis)) throw new Error('invalid tax_date_basis');
  const payout = typeof m.payout_usd_json === 'string' ? parseJson(m.payout_usd_json, null) : m.payout_usd_json;
  if (!payout || typeof payout !== 'object') throw new Error('payout_usd_json must be a JSON object');
  const cleanPayout = Object.fromEntries(PAYOUT_FIELDS.map((k) => [k, String(payout[k] || '').trim()]));
  if (cleanPayout.routing_aba && !isValidAba(cleanPayout.routing_aba)) {
    throw new Error('routing number is not a valid 9-digit ABA number — check for a typo');
  }
  run(
    `UPDATE settings SET base_currency=?, eur_to_rsd=?, display_currency=?,
       seller_name=?, seller_address=?, seller_pib=?, seller_mb=?, seller_bank=?, seller_note=?,
       pdv_obveznik=?, pdv_rate=?,
       seller_name_en=?, seller_brand=?, seller_address_en=?, seller_email=?, seller_phone=?,
       seller_entity_type=?, payout_usd_json=?, tax_date_basis=?
     WHERE id=1`,
    m.base_currency, Number(m.eur_to_rsd), m.display_currency,
    m.seller_name, m.seller_address, m.seller_pib, m.seller_mb, m.seller_bank, m.seller_note,
    m.pdv_obveznik ? 1 : 0, Number(m.pdv_rate) || 0,
    m.seller_name_en, m.seller_brand, m.seller_address_en, m.seller_email, m.seller_phone,
    m.seller_entity_type, JSON.stringify(cleanPayout), m.tax_date_basis
  );
  res.json(readSettings());
}));

// --- static front-end (production) -----------------------------------------
// In the container the Vite build lands in ../dist; serve it + SPA fallback so
// one process answers both the API and the UI. Absent in dev (Vite serves it).
const distDir = join(__dirname, '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(join(distDir, 'index.html'));
  });
  console.log('[web] serving built front-end from dist/');
}

app.listen(PORT, () => {
  console.log(`[api] revenue-tracker on http://localhost:${PORT}`);
  scheduleBackups();
});
