import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import db from './db.js';
import { advanceDueDate } from './money.js';
import { basicAuth } from './auth.js';
import { scheduleBackups } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Gate everything (API + static UI) behind Basic Auth when a password is set.
app.use(basicAuth());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const today = () => new Date().toISOString().slice(0, 10);

// --- helpers ---------------------------------------------------------------
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

function readSettings() {
  return get('SELECT * FROM settings WHERE id = 1');
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
    settings: readSettings(),
    today: today(),
  });
}));

// --- projects --------------------------------------------------------------
app.get('/api/projects', h((_req, res) => {
  res.json(all('SELECT * FROM projects ORDER BY created_at DESC, id DESC'));
}));

app.post('/api/projects', h((req, res) => {
  const { name, client = '', url = '', status = 'active', package: pkg = '', notes = '' } = req.body;
  if (!name || !name.trim()) throw new Error('name is required');
  const info = run(
    `INSERT INTO projects (name, client, url, status, package, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    name.trim(), client, url, status, pkg, notes, today()
  );
  res.status(201).json(get('SELECT * FROM projects WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/projects/:id', h((req, res) => {
  const existing = get('SELECT * FROM projects WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('project not found');
  const { name, client, url, status, package: pkg, notes } = { ...existing, ...req.body };
  run(
    `UPDATE projects SET name=?, client=?, url=?, status=?, package=?, notes=? WHERE id=?`,
    name, client, url, status, pkg, notes, existing.id
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
  if (!get('SELECT id FROM projects WHERE id = ?', project_id)) throw new Error('invalid project_id');
  if (!VALID_DIR.has(direction)) throw new Error('direction must be income or expense');
  if (!VALID_FREQ.has(frequency)) throw new Error('invalid frequency');
  if (Number.isNaN(Number(amount))) throw new Error('amount must be a number');
  const info = run(
    `INSERT INTO charges (project_id, direction, category, label, amount, frequency, next_due, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    project_id, direction, category, label, Number(amount), frequency,
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
  run(
    `UPDATE charges SET direction=?, category=?, label=?, amount=?, frequency=?, next_due=?, active=? WHERE id=?`,
    merged.direction, merged.category, merged.label, Number(merged.amount),
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

  db.exec('BEGIN');
  try {
    run(
      `INSERT INTO payments (charge_id, project_id, direction, amount, paid_on, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      charge.id, charge.project_id, charge.direction, charge.amount, paidOn,
      req.body?.note || `Paid: ${charge.label || charge.category}`
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
app.post('/api/payments', h((req, res) => {
  const { project_id, direction, amount, paid_on = today(), note = '', charge_id = null } = req.body;
  if (!get('SELECT id FROM projects WHERE id = ?', project_id)) throw new Error('invalid project_id');
  if (!VALID_DIR.has(direction)) throw new Error('direction must be income or expense');
  const info = run(
    `INSERT INTO payments (charge_id, project_id, direction, amount, paid_on, note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    charge_id, project_id, direction, Number(amount), paid_on, note
  );
  res.status(201).json(get('SELECT * FROM payments WHERE id = ?', info.lastInsertRowid));
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
  const info = run(
    `INSERT INTO overheads (label, category, amount, frequency, next_due, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    label.trim(), category, Number(amount), frequency, next_due || null, active ? 1 : 0, today()
  );
  res.status(201).json(get('SELECT * FROM overheads WHERE id = ?', info.lastInsertRowid));
}));

app.put('/api/overheads/:id', h((req, res) => {
  const existing = get('SELECT * FROM overheads WHERE id = ?', Number(req.params.id));
  if (!existing) throw new Error('overhead not found');
  const merged = { ...existing, ...req.body };
  if (!merged.label || !String(merged.label).trim()) throw new Error('label is required');
  if (!VALID_FREQ.has(merged.frequency)) throw new Error('invalid frequency');
  run(
    `UPDATE overheads SET label=?, category=?, amount=?, frequency=?, next_due=?, active=? WHERE id=?`,
    String(merged.label).trim(), merged.category, Number(merged.amount),
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
      `INSERT INTO overhead_payments (overhead_id, amount, paid_on, note)
       VALUES (?, ?, ?, ?)`,
      overhead.id, overhead.amount, paidOn, req.body?.note || `Paid: ${overhead.label}`
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

// --- settings --------------------------------------------------------------
app.put('/api/settings', h((req, res) => {
  const cur = readSettings();
  const { base_currency, eur_to_rsd, display_currency } = { ...cur, ...req.body };
  if (Number(eur_to_rsd) <= 0) throw new Error('eur_to_rsd must be positive');
  run(
    'UPDATE settings SET base_currency=?, eur_to_rsd=?, display_currency=? WHERE id=1',
    base_currency, Number(eur_to_rsd), display_currency
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
