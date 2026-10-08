import { describe, it, expect } from 'vitest';
import { invoiceEmail, mailtoHref } from './invoiceEmail.js';

const en = {
  number: '2026-007', lang: 'en', doc_currency: 'USD', stage: 'full', total: 1200,
  issued_on: '2026-09-06', due_on: '2026-09-13',
  seller_json: JSON.stringify({ name_en: 'Jane Example', brand: 'Example Studio', phone: '+1 555 0100' }),
  buyer_json: JSON.stringify({ contact: 'John Smith', email: 'ap@example.com', type: 'company' }),
};
const withBuyer = (b) => ({ ...en, buyer_json: JSON.stringify({ ...JSON.parse(en.buyer_json), ...b }) });

describe('invoiceEmail (en)', () => {
  it('addresses the contact and states amount and due date like the PDF', () => {
    const m = invoiceEmail(en);
    expect(m.to).toBe('ap@example.com');
    expect(m.subject).toBe('Invoice 2026-007 from Example Studio — $1,200.00 due Sep 13, 2026');
    expect(m.body).toMatch(/^Hi John,/);
    expect(m.body).toContain('Invoice 2026-007');
    expect(m.body).toContain('business bank account');
    expect(m.body).toMatch(/Thanks,\nJane Example\nExample Studio/);
  });
  it('gives an individual the payment link and no bank talk', () => {
    const m = invoiceEmail({ ...withBuyer({ type: 'individual' }), payment_link: 'https://pay.example.com/r/abc' });
    expect(m.body).toContain('https://pay.example.com/r/abc');
    expect(m.body).not.toContain('business bank account');
  });
  it('says a link will follow when the individual has none yet', () => {
    expect(invoiceEmail(withBuyer({ type: 'individual' })).body).toContain('payment link');
  });
  it('words deposits as deposits', () => {
    const m = invoiceEmail({ ...en, stage: 'deposit' });
    expect(m.subject).toMatch(/^Deposit invoice 2026-007/);
    expect(m.body).toContain('Work begins as soon as the deposit is received.');
  });
  it('never mentions SWIFT', () => {
    expect(JSON.stringify(invoiceEmail(en))).not.toMatch(/SWIFT/i);
  });
});

describe('invoiceEmail (sr)', () => {
  it('writes a Serbian cover note in the display currency', () => {
    const m = invoiceEmail({
      number: '2026-001', lang: 'sr', kind: 'predracun', currency: 'RSD', eur_to_rsd: 117, subtotal_eur: 800,
      issued_on: '2026-08-20',
      seller_json: JSON.stringify({ name: 'Ime Prezime', bank: '160-0000000000000-00' }),
      buyer_json: JSON.stringify({ name: 'Firma d.o.o.' }),
    });
    expect(m.subject).toBe('Predračun 2026-001 — 20/08/2026');
    expect(m.body).toContain('93.600,00 RSD');
    expect(m.body).toContain('poziv na broj 2026-001');
  });
});

describe('mailtoHref', () => {
  it('encodes recipient, subject and body', () => {
    expect(mailtoHref({ to: 'a@b.com', subject: 'Hi & bye', body: 'x\ny' })).toBe('mailto:a%40b.com?subject=Hi%20%26%20bye&body=x%0Ay');
  });
});
