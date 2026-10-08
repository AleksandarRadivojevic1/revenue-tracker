import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'payments.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    client TEXT DEFAULT '',
    url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    package TEXT DEFAULT '',           -- catalog key: start | standard | plus | webapp | ''
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,            -- income | expense
    category TEXT NOT NULL DEFAULT 'other',
    label TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'one_time', -- one_time | monthly | yearly
    next_due TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    charge_id INTEGER REFERENCES charges(id) ON DELETE SET NULL,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    paid_on TEXT NOT NULL DEFAULT (date('now')),
    note TEXT DEFAULT ''
  );

  -- Out-of-project costs (business overhead): subscriptions, tools, hosting,
  -- domains — expenses not tied to any single client project.
  CREATE TABLE IF NOT EXISTS overheads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'tool',   -- hosting | domain | tool | other
    amount REAL NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'monthly', -- one_time | monthly | yearly
    next_due TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  -- Realized overhead spend. Kept even if the overhead is deleted, so totals
  -- never silently drop (ON DELETE SET NULL, not CASCADE).
  CREATE TABLE IF NOT EXISTS overhead_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    overhead_id INTEGER REFERENCES overheads(id) ON DELETE SET NULL,
    amount REAL NOT NULL DEFAULT 0,
    paid_on TEXT NOT NULL DEFAULT (date('now')),
    note TEXT DEFAULT ''
  );

  -- Issued invoices / proformas. Immutable once created: seller, buyer, line
  -- items and the EUR→RSD rate are all snapshotted as JSON at issue time, so a
  -- later edit to a charge or the exchange rate never changes a past document.
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL,                      -- YYYY-NNN, sequential per year
    kind TEXT NOT NULL DEFAULT 'predracun',    -- predracun | racun
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    issued_on TEXT NOT NULL DEFAULT (date('now')),
    supply_date TEXT,
    place TEXT DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'RSD',       -- RSD | EUR | BOTH
    eur_to_rsd REAL NOT NULL DEFAULT 0,         -- rate snapshot used for RSD figures
    seller_json TEXT NOT NULL DEFAULT '{}',
    buyer_json TEXT NOT NULL DEFAULT '{}',
    items_json TEXT NOT NULL DEFAULT '[]',      -- [{description, qty, unit_eur, amount_eur}]
    subtotal_eur REAL NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    base_currency TEXT NOT NULL DEFAULT 'EUR',
    eur_to_rsd REAL NOT NULL DEFAULT 117.0,
    display_currency TEXT NOT NULL DEFAULT 'EUR'
  );

  INSERT OR IGNORE INTO settings (id) VALUES (1);
`);

// Lightweight migration: add columns that older DB files may be missing.
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
ensureColumn('projects', 'package', "TEXT DEFAULT ''");

// Seller (my business) details for invoices — live on the single settings row.
ensureColumn('settings', 'seller_name', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_address', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_pib', "TEXT DEFAULT ''");   // presence flips predracun -> racun
ensureColumn('settings', 'seller_mb', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_bank', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_note', "TEXT DEFAULT ''");

// Buyer (client) legal details, per project.
ensureColumn('projects', 'client_address', "TEXT DEFAULT ''");
ensureColumn('projects', 'client_pib', "TEXT DEFAULT ''");
ensureColumn('projects', 'client_mb', "TEXT DEFAULT ''");

// PDV (VAT) readiness. Off by default — flip pdv_obveznik only once actually in
// the PDV system (turnover threshold or voluntary registration). While off,
// invoices carry rate 0 and print exactly as before.
ensureColumn('settings', 'pdv_obveznik', 'INTEGER DEFAULT 0'); // 1 = in the PDV system
ensureColumn('settings', 'pdv_rate', 'REAL DEFAULT 20');       // default general rate (%)

// Tax snapshot per invoice — frozen at issue time like every other invoice
// field, so past documents never change when your PDV status later does.
// Non-PDV / exempt invoices store rate 0, pdv 0, total == subtotal.
ensureColumn('invoices', 'pdv_rate', 'REAL DEFAULT 0');
ensureColumn('invoices', 'pdv_eur', 'REAL DEFAULT 0');
ensureColumn('invoices', 'total_eur', 'REAL DEFAULT 0');
ensureColumn('invoices', 'pdv_exempt', 'INTEGER DEFAULT 0');   // 1 = foreign client / izvoz usluga

// --- US clients ------------------------------------------------------------
// Native currency per money row (EUR | USD | RSD). Every default renders the
// rows that existed before exactly as they were: EUR.
for (const t of ['charges', 'payments', 'overheads', 'overhead_payments', 'projects']) {
  ensureColumn(t, 'currency', "TEXT DEFAULT 'EUR'");
}

// Client details for foreign (US) clients, per project.
ensureColumn('projects', 'client_country', "TEXT DEFAULT 'RS'");        // ISO 3166 alpha-2
ensureColumn('projects', 'client_type', "TEXT DEFAULT 'company'");      // company | individual
ensureColumn('projects', 'client_legal_name', "TEXT DEFAULT ''");       // the entity, not the owner
ensureColumn('projects', 'client_contact', "TEXT DEFAULT ''");
ensureColumn('projects', 'client_email', "TEXT DEFAULT ''");
ensureColumn('projects', 'sow_ref', "TEXT DEFAULT ''");
ensureColumn('projects', 'w8ben_sent_on', 'TEXT');

// Invoice snapshot: `currency` stays the RSD/EUR/BOTH *display mode* of a EUR
// document; doc_currency is the currency the amounts are actually in. New rows
// store items as {unit, amount} plus subtotal/pdv/total in doc_currency; old
// rows keep the *_eur columns and the renderer falls back to them.
ensureColumn('invoices', 'doc_currency', "TEXT DEFAULT 'EUR'");
ensureColumn('invoices', 'lang', "TEXT DEFAULT 'sr'");                  // sr | en
ensureColumn('invoices', 'subtotal', 'REAL');
ensureColumn('invoices', 'pdv', 'REAL');
ensureColumn('invoices', 'total', 'REAL');
ensureColumn('invoices', 'due_on', 'TEXT');
ensureColumn('invoices', 'terms', "TEXT DEFAULT ''");                   // Due on receipt | Net 7 | Net 14
ensureColumn('invoices', 'stage', "TEXT DEFAULT 'full'");               // full | deposit | balance
ensureColumn('invoices', 'deposit_ref', "TEXT DEFAULT ''");             // deposit invoice no. (balance stage)
// Invoices are voided, never deleted, so an issued number is never reused.
ensureColumn('invoices', 'status', "TEXT DEFAULT 'issued'");            // issued | void

// English seller identity — must match the Payoneer profile character for
// character. Real values live only in this (gitignored) DB, never in code.
ensureColumn('settings', 'seller_name_en', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_brand', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_address_en', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_email', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_phone', "TEXT DEFAULT ''");
ensureColumn('settings', 'seller_entity_type', "TEXT DEFAULT 'individual'"); // individual | preduzetnik | doo
ensureColumn('settings', 'payout_usd_json', "TEXT DEFAULT '{}'");        // USD receiving account
ensureColumn('settings', 'tax_date_basis', "TEXT DEFAULT 'paid_on'");    // paid_on | received_on
// 1 = English invoices also carry the Serbian title ("INVOICE / RAČUN"), if
// the accountant says foreign invoices need it once registered.
ensureColumn('settings', 'en_title_bilingual', 'INTEGER DEFAULT 0');

// Tax records per payment, for the quarterly freelancer filing.
ensureColumn('payments', 'received_on', 'TEXT');        // credited in Payoneer
ensureColumn('payments', 'channel', 'TEXT');            // payoneer_receiving_ach | payoneer_request_ach | payoneer_request_card | domestic
ensureColumn('payments', 'fee', 'REAL DEFAULT 0');      // processor fee, in the payment's currency
ensureColumn('payments', 'nbs_rate_rsd', 'REAL');       // NBS middle rate, currency → RSD
ensureColumn('payments', 'amount_rsd', 'REAL');         // gross × rate, snapshotted

// Invoice payment tracking: a payment can settle (part of) an invoice.
// Invoices issued before this existed stay tracked = 0 and never show as
// outstanding — they were settled through their charges.
ensureColumn('payments', 'invoice_id', 'INTEGER REFERENCES invoices(id) ON DELETE SET NULL');
ensureColumn('invoices', 'tracked', 'INTEGER DEFAULT 0');
// Payoneer payment-request link for the cover email. Not printed on the PDF,
// so it's the one invoice field that may be set after issue.
ensureColumn('invoices', 'payment_link', "TEXT DEFAULT ''");

// Payoneer → bank transfers (e.g. USD out, EUR in). Not revenue; the
// conversion cost (vs NBS middle rates of the day) counts as an expense.
db.exec(`
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transferred_on TEXT NOT NULL,
    out_amount REAL NOT NULL,
    out_currency TEXT NOT NULL DEFAULT 'USD',
    in_amount REAL NOT NULL,
    in_currency TEXT NOT NULL DEFAULT 'EUR',
    nbs_out_rsd REAL,
    nbs_in_rsd REAL,
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (date('now'))
  );
`);

// Cache of NBS middle rates (currency → RSD) by date, filled on demand.
db.exec(`
  CREATE TABLE IF NOT EXISTS nbs_rates (
    currency TEXT NOT NULL,
    date TEXT NOT NULL,
    rate REAL NOT NULL,
    PRIMARY KEY (currency, date)
  );
`);

export default db;
