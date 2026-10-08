import { describe, it, expect } from 'vitest';
import { leadsSummary, parseCsv, parseLeadsCsv, followUpDue } from './leads.js';

describe('leadsSummary', () => {
  const leads = [
    { status: 'new' },
    { status: 'replied', value: 1500, currency: 'USD', next_action_on: '2026-10-08' },
    { status: 'proposal', value: 2000, currency: 'USD', next_action_on: '2026-10-20' },
    { status: 'contacted', value: 900 },                 // not in play yet
    { status: 'won', value: 3000, currency: 'USD', next_action_on: '2026-10-01' },
    { status: 'lost' },
  ];
  it('counts by status, open leads and due follow-ups', () => {
    const s = leadsSummary(leads, '2026-10-08');
    expect(s.byStatus).toMatchObject({ new: 1, replied: 1, proposal: 1, contacted: 1, won: 1, lost: 1, call: 0 });
    expect(s.open).toBe(4);
    expect(s.followUpsDue).toBe(1); // won leads never need a follow-up
  });
  it('pipeline sums only replied-or-further deals, per currency', () => {
    expect(leadsSummary(leads, '2026-10-08').pipeline).toEqual({ USD: 3500 });
  });
  it('a follow-up is due on or after its date', () => {
    expect(followUpDue({ status: 'call', next_action_on: '2026-10-08' }, '2026-10-08')).toBe(true);
    expect(followUpDue({ status: 'call', next_action_on: '2026-10-09' }, '2026-10-08')).toBe(false);
  });
});

describe('CSV import', () => {
  it('parses quotes, escaped quotes, commas in fields and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
  it('maps known headers, folds city into notes, drops empty rows', () => {
    const csv = [
      'Business Name,Owner,Email,City,Ignored',
      '"Smith Kitchen & Bath, LLC",John,john@example.com,Columbus OH,zzz',
      ',,,,',
      'No Email Co,,,,',
    ].join('\n');
    expect(parseLeadsCsv(csv)).toEqual([
      { company: 'Smith Kitchen & Bath, LLC', contact: 'John', email: 'john@example.com', notes: 'Columbus OH' },
      { company: 'No Email Co' },
    ]);
  });
  it('empty input → no leads', () => {
    expect(parseLeadsCsv('')).toEqual([]);
  });
});
