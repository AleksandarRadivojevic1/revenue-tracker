import { describe, it, expect } from 'vitest';
import { buildInvoiceDocDefinition } from './invoicePdf.js';

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

  it('BOTH currency shows RSD (converted) and EUR, and prints the rate', () => {
    const text = allText(buildInvoiceDocDefinition({ ...base, kind: 'racun', currency: 'BOTH' })).join('\n');
    expect(text).toContain('93.600,00 RSD'); // 800 × 117
    expect(text).toContain('800,00 €');
    expect(text).toContain('1 € = 117,00 RSD');
  });
});
