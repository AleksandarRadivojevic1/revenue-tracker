// Pure lead-pipeline logic (no I/O) — shared by the API and the UI,
// unit-tested in leads.test.js.
import { currencyOf } from './money.js';

export const LEAD_STATUSES = ['new', 'contacted', 'replied', 'call', 'proposal', 'won', 'lost'];
export const LEAD_STATUS_LABEL = {
  new: 'New', contacted: 'Contacted', replied: 'Replied', call: 'Call booked',
  proposal: 'Proposal sent', won: 'Won', lost: 'Lost',
};
// Stages where a deal is genuinely in play — they make up the pipeline value.
const IN_PLAY = new Set(['replied', 'call', 'proposal']);
const CLOSED = new Set(['won', 'lost']);

export const isOpenLead = (l) => !CLOSED.has(l.status);
export const followUpDue = (l, today) => isOpenLead(l) && Boolean(l.next_action_on) && l.next_action_on <= today;

/**
 * { byStatus: {status: count}, open, followUpsDue, pipeline: {currency: value} }.
 * Pipeline = estimated value of leads that replied or further, per currency.
 */
export function leadsSummary(leads, today) {
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  const pipeline = {};
  let open = 0;
  let followUpsDue = 0;
  for (const l of leads) {
    byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    if (isOpenLead(l)) open += 1;
    if (followUpDue(l, today)) followUpsDue += 1;
    if (IN_PLAY.has(l.status) && Number(l.value) > 0) {
      const c = currencyOf(l);
      pipeline[c] = (pipeline[c] || 0) + Number(l.value);
    }
  }
  return { byStatus, open, followUpsDue, pipeline };
}

// --- CSV import --------------------------------------------------------------

/** Split CSV text into rows of fields (handles quotes, "" escapes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// Header names we understand, mapped to lead fields.
const HEADER_MAP = {
  company: 'company', business: 'company', 'business name': 'company', name: 'company',
  contact: 'contact', owner: 'contact', 'contact name': 'contact', 'first name': 'contact',
  email: 'email', 'e-mail': 'email',
  phone: 'phone',
  website: 'website', url: 'website', site: 'website',
  source: 'source', notes: 'notes', note: 'notes',
  country: 'country', city: 'city',
};

/**
 * Leads from a CSV with a header row. Unknown columns are ignored; `city` is
 * folded into notes. Rows with neither a company nor an email are dropped.
 */
export function parseLeadsCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
  return rows
    .map((r) => {
      const lead = {};
      keys.forEach((k, i) => { if (k && r[i] != null && r[i].trim()) lead[k] = r[i].trim(); });
      if (lead.city) { lead.notes = [lead.notes, lead.city].filter(Boolean).join(' · '); delete lead.city; }
      if (lead.country) lead.country = lead.country.toUpperCase().slice(0, 2);
      return lead;
    })
    .filter((l) => l.company || l.email);
}
