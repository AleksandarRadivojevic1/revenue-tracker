// Cover email to send with an invoice PDF. Pure — unit-tested in
// invoiceEmail.test.js. The amount comes from invoiceAmountText so the email
// and the PDF always show the same figure.
import { formatDate, formatDateLong } from './format.js';
import { invoiceAmountText } from './invoicePdf.js';
import { invoiceTotal } from '../server/money.js';

const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const STAGE_WORD = { deposit: 'deposit invoice', balance: 'balance invoice', full: 'invoice' };

function englishEmail(invoice, seller, buyer) {
  const amount = invoiceAmountText(invoice, invoiceTotal(invoice));
  const due = formatDateLong(invoice.due_on || invoice.issued_on);
  const brand = seller.brand || seller.name_en || seller.name;
  const firstName = (buyer.contact || '').trim().split(/\s+/)[0];
  const lines = [
    `Hi ${firstName || 'there'},`,
    '',
    `Please find attached ${STAGE_WORD[invoice.stage] || 'invoice'} ${invoice.number} for ${amount}, due ${due}.`,
    '',
  ];
  if ((invoice.doc_currency || 'EUR') === 'USD' && buyer.type === 'individual') {
    lines.push(invoice.payment_link
      ? `You can pay securely by card or ACH debit here:\n${invoice.payment_link}`
      : 'I\'ll send a secure Payoneer payment link (card or ACH debit) separately.');
  } else if ((invoice.doc_currency || 'EUR') === 'USD') {
    lines.push(`ACH (preferred) or wire details are on the invoice. Please pay from your business bank account and use "Invoice ${invoice.number}" as the payment reference.`);
    if (invoice.payment_link) lines.push('', `Prefer to pay by card? Use this secure link:\n${invoice.payment_link}`);
  } else {
    lines.push(`Payment details are on the invoice — please use "Invoice ${invoice.number}" as the payment reference.`);
  }
  if (invoice.stage === 'deposit') lines.push('', 'Work begins as soon as the deposit is received.');
  lines.push('', 'Thanks,', seller.name_en || seller.name, ...(brand && brand !== (seller.name_en || seller.name) ? [brand] : []));
  if (seller.phone) lines.push(seller.phone);
  return {
    subject: `${STAGE_WORD[invoice.stage] === 'invoice' ? 'Invoice' : STAGE_WORD[invoice.stage].replace(/^./, (c) => c.toUpperCase())} ${invoice.number} from ${brand} — ${amount} due ${due}`,
    body: lines.join('\n'),
  };
}

function serbianEmail(invoice, seller) {
  const title = invoice.kind === 'racun' ? 'račun' : 'predračun';
  const amount = invoiceAmountText(invoice, invoiceTotal(invoice));
  const lines = ['Poštovani,', '', `U prilogu je ${title} br. ${invoice.number} na iznos od ${amount}.`];
  if (seller.bank) lines.push(`Uplatu možete izvršiti na tekući račun ${seller.bank}, poziv na broj ${invoice.number}.`);
  lines.push('', 'Srdačan pozdrav,', seller.name);
  return {
    subject: `${title.replace(/^./, (c) => c.toUpperCase())} ${invoice.number} — ${formatDate(invoice.issued_on)}`,
    body: lines.join('\n'),
  };
}

/** { to, subject, body } for an invoice's cover email. */
export function invoiceEmail(invoice) {
  const seller = parse(invoice.seller_json);
  const buyer = parse(invoice.buyer_json);
  const mail = invoice.lang === 'en' ? englishEmail(invoice, seller, buyer) : serbianEmail(invoice, seller);
  return { to: buyer.email || '', ...mail };
}

/** mailto: link that opens the email pre-filled (attach the PDF by hand). */
export function mailtoHref({ to, subject, body }) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
