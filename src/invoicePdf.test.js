import { describe, it, expect } from 'vitest';
import { buildInvoiceDocDefinition, invoiceFilename } from './invoicePdf.js';

// Collect every string of text anywhere in a pdfmake docDefinition.
function allText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  if (typeof node === 'object') {
    if (typeof node.text === 'string') out.push(node.text);
    for (const [k, v] of Object.entries(node)) if (k !== 'text') allText(v, out);
  }
  return out;
}

const base = {
  number: '2026-001', issued_on: '2026-08-20', supply_date: '2026-08-20', place: 'Leskovac',
  eur_to_rsd: 117, subtotal_eur: 800, note: '',
  seller_json: JSON.stringify({ name: 'Aleksandar Radivojević PR', pib: '111222333', bank: '160-00' }),
  buyer_json: JSON.stringify({ name: 'Optika Cajs d.o.o.', pib: '123456789' }),
  items_json: JSON.stringify([{ description: 'Izrada sajta', qty: 1, unit_eur: 800, amount_eur: 800 }]),
};

describe('buildInvoiceDocDefinition', () => {
  it('renders a račun with seller, buyer and line item', () => {
    const text = allText(buildInvoiceDocDefinition({ ...base, kind: 'racun', currency: 'EUR' })).join('\n');
    expect(text).toContain('RAČUN');
    expect(text).toContain('2026-001');
    expect(text).toContain('Aleksandar Radivojević PR');
    expect(text).toContain('Optika Cajs d.o.o.');
    expect(text).toContain('Izrada sajta');
    expect(text).toContain('800,00 €');
    expect(text).toContain('20/08/2026'); // dd/mm/yyyy
  });

  it('labels a predracun and notes it is not a tax document', () => {
    const text = allText(buildInvoiceDocDefinition({ ...base, kind: 'predracun', currency: 'EUR' })).join('\n');
    expect(text).toContain('PREDRAČUN');
    expect(text).toContain('Predračun nije poreski dokument.');
  });

  it('breaks out PDV (osnovica / PDV / ukupno) when the invoice carries a rate', () => {
    const text = allText(buildInvoiceDocDefinition({
      ...base, kind: 'racun', currency: 'EUR', pdv_rate: 20, pdv_eur: 160, total_eur: 960,
    })).join('\n');
    expect(text).toContain('Osnovica');
    expect(text).toContain('PDV (20%)');
    expect(text).toContain('160,00 €'); // PDV amount
    expect(text).toContain('960,00 €'); // ukupno with PDV
    expect(text).not.toContain('PDV nije obračunat');
  });

  it('notes the export exemption for a foreign-client invoice', () => {
    const text = allText(buildInvoiceDocDefinition({
      ...base, kind: 'racun', currency: 'EUR', pdv_exempt: 1,
    })).join('\n');
    expect(text).toContain('izvoz usluga');
    expect(text).not.toContain('PDV nije obračunat');
  });

  it('BOTH currency shows RSD (converted) and EUR, and prints the rate', () => {
    const text = allText(buildInvoiceDocDefinition({ ...base, kind: 'racun', currency: 'BOTH' })).join('\n');
    expect(text).toContain('93.600,00 RSD'); // 800 × 117
    expect(text).toContain('800,00 €');
    expect(text).toContain('1 € = 117,00 RSD');
  });
});

// Fake numbers only — this repo is public. Real payout details live in the DB.
const FAKE_PAYOUT = {
  bank_name: 'Example Bank', bank_address: '1 Example Plaza, Springfield, ST 00000',
  routing_aba: '123456780', account_number: '0000111122223333', account_type: 'Checking',
  beneficiary_name: 'Jane Example', beneficiary_address: '1 Test St, Testville',
};
const en = {
  number: '2026-007', kind: 'predracun', lang: 'en', doc_currency: 'USD', currency: 'USD',
  issued_on: '2026-09-06', supply_date: '2026-09-06', due_on: '2026-09-13', terms: 'Net 7',
  stage: 'full', status: 'issued', eur_to_rsd: 0, pdv_rate: 0, note: '',
  subtotal: 1200, pdv: 0, total: 1200, subtotal_eur: 0, total_eur: 0,
  seller_json: JSON.stringify({
    name: 'Jane Exampleić PR', name_en: 'Jane Example', brand: 'Example Studio',
    address_en: '1 Test St\nTestville', email: 'jane@example.com', phone: '+1 555 0100',
    pib: '', bank: '160-0000000000000-00', payout_usd: FAKE_PAYOUT,
  }),
  buyer_json: JSON.stringify({
    name: 'Smith Kitchen & Bath LLC', contact: 'John Smith', address: '10 Main St\nColumbus, OH 43004',
    country: 'US', type: 'company', sow_ref: 'SKB-01',
  }),
  items_json: JSON.stringify([{ description: 'Conversion sprint', qty: 1, unit: 1200, amount: 1200 }]),
};
const enText = (over = {}, buyerOver = null) => {
  const inv = { ...en, ...over };
  if (buyerOver) inv.buyer_json = JSON.stringify({ ...JSON.parse(en.buyer_json), ...buyerOver });
  return allText(buildInvoiceDocDefinition(inv)).join('\n');
};

describe('English (US) invoice', () => {
  it('reads as a US invoice: title, $ amounts, unambiguous dates', () => {
    const text = enText();
    expect(text).toContain('INVOICE');
    expect(text).toContain('Invoice No. 2026-007');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('Sep 6, 2026');
    expect(text).toContain('Due date: Sep 13, 2026');
    expect(text).toContain('TOTAL DUE (USD)');
    expect(text).toContain('Ref: SOW SKB-01');
  });

  it('bills the entity and prints the ASCII Payoneer name, with the brand only as a header', () => {
    const text = enText();
    expect(text).toContain('BILL TO');
    expect(text).toContain('Smith Kitchen & Bath LLC');
    expect(text).toContain('Attn: John Smith');
    expect(text).toContain('Jane Example');
    expect(text).not.toContain('Exampleić');
    expect(text).toContain('Example Studio');
  });

  it('carries none of the Serbian notes, PDV or RSD text', () => {
    const text = enText();
    for (const s of ['PDV', 'RSD', 'Predračun', 'PREDRAČUN', 'Matični', 'Uplata', 'Mesto']) expect(text).not.toContain(s);
  });

  it('gives a company ACH details plus the business-account warning and reference', () => {
    const text = enText();
    expect(text).toContain('123456780');
    expect(text).toContain('0000111122223333');
    expect(text).toContain('Please pay from your business bank account');
    expect(text).toContain('Payment reference: Invoice 2026-007');
    expect(text).toContain('Card payment available on request via secure payment link.');
  });

  it('prints no bank block at all for an individual client', () => {
    const text = enText({}, { type: 'individual' });
    expect(text).not.toContain('123456780');
    expect(text).not.toContain('0000111122223333');
    expect(text).not.toContain('Routing');
    expect(text).not.toContain('Example Bank');
    expect(text).toContain('Payoneer payment link');
  });

  it('never prints SWIFT', () => {
    expect(enText()).not.toMatch(/SWIFT/i);
    expect(enText({}, { type: 'individual' })).not.toMatch(/SWIFT/i);
  });

  it('titles deposit and balance stages', () => {
    const dep = enText({ stage: 'deposit' });
    expect(dep).toContain('DEPOSIT INVOICE');
    expect(dep).toContain('Work begins when this deposit is received.');
    const bal = enText({ stage: 'balance', deposit_ref: '2026-005' });
    expect(bal).toContain('INVOICE — BALANCE');
    expect(bal).toContain('2026-005');
  });

  it('prints Tax ID (PIB) only once registered', () => {
    expect(enText()).not.toContain('Tax ID');
    const seller = { ...JSON.parse(en.seller_json), pib: '111222333' };
    expect(enText({ seller_json: JSON.stringify(seller) })).toContain('Tax ID (PIB): 111222333');
  });

  it('adds the Serbian title only when issued with the bilingual setting', () => {
    const seller = { ...JSON.parse(en.seller_json), pib: '111222333', title_bilingual: true };
    const text = enText({ kind: 'racun', seller_json: JSON.stringify(seller) });
    expect(text).toContain('INVOICE / RAČUN');
    expect(enText({ kind: 'racun' })).not.toContain('RAČUN');
  });

  it('uses US Letter with the separator sized to the page', () => {
    const doc = buildInvoiceDocDefinition(en);
    expect(doc.pageSize).toBe('LETTER');
    expect(doc.content[1].canvas[0].x2).toBe(532);
  });

  it('names the file after the brand', () => {
    expect(invoiceFilename(en)).toBe('Invoice-2026-007-Example-Studio.pdf');
    expect(invoiceFilename({ ...base, kind: 'predracun', number: '2026-001' })).toBe('predracun-2026-001.pdf');
  });
});

describe('void invoices', () => {
  it('stamps VOID on an English invoice and nothing on an issued one', () => {
    expect(buildInvoiceDocDefinition({ ...en, status: 'void' }).watermark.text).toBe('VOID');
    expect(buildInvoiceDocDefinition(en).watermark).toBeUndefined();
  });
  it('stamps a voided Serbian document too', () => {
    expect(buildInvoiceDocDefinition({ ...base, kind: 'racun', currency: 'EUR', status: 'void' }).watermark.text).toBe('PONIŠTENO');
  });
});

describe('Serbian document in a native non-EUR currency', () => {
  it('prints USD amounts as-is with no rate line', () => {
    const text = allText(buildInvoiceDocDefinition({
      ...base, kind: 'racun', currency: 'USD', doc_currency: 'USD', eur_to_rsd: 0, total: 800,
      items_json: JSON.stringify([{ description: 'Izrada sajta', qty: 1, unit: 800, amount: 800 }]),
    })).join('\n');
    expect(text).toContain('800,00 USD');
    expect(text).not.toContain('Preračunato');
  });
});
