// Builds and downloads an invoice PDF from a stored invoice record: the
// Serbian predračun/račun (lang 'sr') or an English US-style invoice ('en').
// pdfmake + its font vfs are imported dynamically so they stay out of the main
// bundle — only loaded when you actually click Download.
import { formatDate, formatDateLong } from './format.js';

const nf = (min, max) => new Intl.NumberFormat('sr-RS', { minimumFractionDigits: min, maximumFractionDigits: max });
const eur = (n) => `${nf(2, 2).format(n)} €`;
const rsd = (n, rate) => `${nf(2, 2).format(n * rate)} RSD`;

// Render one EUR amount per the invoice's currency mode (rate is snapshotted).
function money(amountEur, currency, rate) {
  if (currency === 'EUR') return eur(amountEur);
  if (currency === 'RSD') return rsd(amountEur, rate);
  return `${rsd(amountEur, rate)}\n(${eur(amountEur)})`; // BOTH
}

// Native (non-EUR) amounts on a Serbian document: no conversion, no rate.
const native = (n, cur) => `${nf(2, 2).format(n)} ${cur}`;

// Amount fields: new rows store them in doc_currency ({unit, amount},
// subtotal/pdv/total); rows issued before that stored *_eur only.
const unitOf = (i) => i.unit ?? i.unit_eur;
const amountOf = (i) => i.amount ?? i.amount_eur;
const subtotalOf = (inv) => inv.subtotal ?? inv.subtotal_eur;
const pdvOf = (inv) => inv.pdv ?? inv.pdv_eur;
const totalOf = (inv) => inv.total ?? (inv.total_eur || inv.subtotal_eur); // fallback for pre-PDV rows

const voidMark = (invoice, text) =>
  invoice.status === 'void' ? { text, color: '#d32f2f', opacity: 0.25, bold: true } : undefined;

function party(title, p) {
  const lines = [{ text: title, style: 'partyLabel' }, { text: p.name || '—', bold: true }];
  if (p.address) lines.push({ text: p.address });
  if (p.pib) lines.push({ text: `PIB: ${p.pib}` });
  if (p.mb) lines.push({ text: `Matični broj: ${p.mb}` });
  return { width: '*', stack: lines };
}

// Pure — no pdfmake, no browser APIs — so it can be unit-tested. Returns the
// pdfmake docDefinition for a stored invoice record.
export function buildInvoiceDocDefinition(invoice) {
  if (invoice.lang === 'en') return buildEnglishDocDefinition(invoice);

  const seller = JSON.parse(invoice.seller_json || '{}');
  const buyer = JSON.parse(invoice.buyer_json || '{}');
  const items = JSON.parse(invoice.items_json || '[]');
  const { currency, eur_to_rsd: rate } = invoice;
  const docCur = invoice.doc_currency || 'EUR';
  const fmt = docCur === 'EUR' ? (n) => money(n, currency, rate) : (n) => native(n, docCur);
  const isRacun = invoice.kind === 'racun';
  const title = isRacun ? 'RAČUN' : 'PREDRAČUN';
  const pdvRate = Number(invoice.pdv_rate) || 0;
  const totalEur = totalOf(invoice);

  const body = [
    [
      { text: 'Opis', style: 'th' },
      { text: 'Količina', style: 'th', alignment: 'right' },
      { text: 'Jed. cena', style: 'th', alignment: 'right' },
      { text: 'Iznos', style: 'th', alignment: 'right' },
    ],
    ...items.map((i) => [
      { text: i.description },
      { text: nf(0, 2).format(i.qty), alignment: 'right' },
      { text: fmt(unitOf(i)), alignment: 'right' },
      { text: fmt(amountOf(i)), alignment: 'right' },
    ]),
  ];

  const notes = [];
  if (!isRacun) notes.push('Predračun nije poreski dokument.');
  if (pdvRate > 0) {
    // PDV is broken out in the totals — no disclaimer needed.
  } else if (invoice.pdv_exempt) {
    notes.push('PDV se ne obračunava — promet usluga u inostranstvu (izvoz usluga).');
  } else {
    notes.push('PDV nije obračunat — obveznik nije u sistemu PDV-a.');
  }
  if (docCur === 'EUR' && currency !== 'EUR') notes.push(`Preračunato po kursu 1 € = ${nf(2, 2).format(rate)} RSD.`);
  if (seller.bank) notes.push(`Uplata na tekući račun: ${seller.bank}   Poziv na broj: ${invoice.number}`);
  if (invoice.note) notes.push(invoice.note);

  const docDefinition = {
    pageSize: 'A4',
    watermark: voidMark(invoice, 'PONIŠTENO'),
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    content: [
      {
        columns: [
          { stack: [{ text: title, style: 'title' }, { text: `Broj: ${invoice.number}`, style: 'subtle' }] },
          {
            width: 'auto',
            stack: [
              { text: `Datum izdavanja: ${formatDate(invoice.issued_on)}`, alignment: 'right' },
              { text: `Datum prometa: ${formatDate(invoice.supply_date)}`, alignment: 'right' },
              invoice.place ? { text: `Mesto: ${invoice.place}`, alignment: 'right' } : {},
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 0.5, lineColor: '#cccccc' }], margin: [0, 6, 0, 12] },
      { columns: [party('PRODAVAC', seller), { width: 20, text: '' }, party('KUPAC', buyer)], margin: [0, 0, 0, 16] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0.2),
          vLineWidth: () => 0,
          hLineColor: () => '#cccccc',
          paddingTop: () => 6, paddingBottom: () => 6,
        },
      },
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            table: {
              widths: ['auto', 'auto'],
              body: pdvRate > 0
                ? [
                    [{ text: 'Osnovica', style: 'totalLabel' }, { text: fmt(subtotalOf(invoice)), alignment: 'right' }],
                    [{ text: `PDV (${nf(0, 2).format(pdvRate)}%)`, style: 'totalLabel' }, { text: fmt(pdvOf(invoice)), alignment: 'right' }],
                    [{ text: 'UKUPNO', style: 'totalLabel' }, { text: fmt(totalEur), style: 'totalValue', alignment: 'right' }],
                  ]
                : [[{ text: 'UKUPNO', style: 'totalLabel' }, { text: fmt(totalEur), style: 'totalValue', alignment: 'right' }]],
            },
            layout: 'noBorders',
            margin: [0, 10, 0, 0],
          },
        ],
      },
      { text: notes.join('\n'), style: 'subtle', margin: [0, 24, 0, 0] },
    ],
    styles: {
      title: { fontSize: 20, bold: true },
      subtle: { fontSize: 9, color: '#666666' },
      partyLabel: { fontSize: 8, bold: true, color: '#888888', margin: [0, 0, 0, 3] },
      th: { fontSize: 9, bold: true, color: '#555555' },
      totalLabel: { bold: true, margin: [0, 0, 12, 0] },
      totalValue: { bold: true },
    },
  };

  return docDefinition;
}

/**
 * One amount exactly as the invoice prints it — shared with the email
 * template so the two never disagree. ('sr' BOTH collapses to one line.)
 */
export function invoiceAmountText(invoice, n) {
  const docCur = invoice.doc_currency || 'EUR';
  if (invoice.lang === 'en') return new Intl.NumberFormat('en-US', { style: 'currency', currency: docCur }).format(Number(n) || 0);
  if (docCur !== 'EUR') return native(n, docCur);
  return money(n, invoice.currency, invoice.eur_to_rsd).replace('\n', ' ');
}

// --- English (US client) invoice -------------------------------------------

const EN_TITLE = { full: 'INVOICE', deposit: 'DEPOSIT INVOICE', balance: 'INVOICE — BALANCE' };
const LETTER_WIDTH = 612;
const EN_MARGIN = 40;

const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);

function partyEn(title, rows) {
  return {
    width: '*',
    stack: [{ text: title, style: 'partyLabel' }, ...rows.filter(Boolean).map((r, i) => (i === 0 ? { text: r, bold: true } : { text: r }))],
  };
}

// The USD payment block. A US company pays the receiving account by ACH/wire;
// a US individual gets no bank details at all (the receiving account returns
// personal-account transfers) and pays via a Payoneer link instead. SWIFT is
// never printed — international SWIFT into this account is marketplace-only.
function usdPaymentBlock(invoice, seller, buyer) {
  const out = [];
  if (buyer.type === 'individual') {
    out.push({ text: 'Pay via the secure Payoneer payment link sent with this invoice (card or ACH debit).' });
  } else {
    const p = seller.payout_usd || {};
    const kv = [
      ['Beneficiary', p.beneficiary_name || seller.name_en || seller.name],
      ['Beneficiary address', p.beneficiary_address || seller.address_en],
      ['Bank', p.bank_name],
      ['Bank address', p.bank_address],
      ['Routing number (ABA)', p.routing_aba],
      ['Account number', p.account_number],
      ['Account type', p.account_type],
    ].filter(([, v]) => v);
    out.push({ text: 'Pay by ACH (preferred) or domestic wire to:', margin: [0, 0, 0, 4] });
    out.push({
      table: { widths: ['auto', '*'], body: kv.map(([k, v]) => [{ text: k, color: '#666666' }, { text: v }]) },
      layout: 'noBorders',
      margin: [0, 0, 0, 6],
    });
    out.push({ text: 'Please pay from your business bank account — transfers from personal accounts are returned by the receiving bank.' });
    out.push({ text: `Payment reference: Invoice ${invoice.number}`, bold: true, margin: [0, 4, 0, 0] });
  }
  out.push({ text: 'Card payment available on request via secure payment link.', margin: [0, 4, 0, 0] });
  return out;
}

// "INVOICE", or "INVOICE / RAČUN" when the invoice was issued with the
// bilingual-title setting on (snapshotted on the seller).
function enTitle(invoice, seller, stage) {
  const en = EN_TITLE[stage] || 'INVOICE';
  if (!seller.title_bilingual) return en;
  return `${en} / ${invoice.kind === 'racun' ? 'RAČUN' : 'PREDRAČUN'}`;
}

export function buildEnglishDocDefinition(invoice) {
  const seller = JSON.parse(invoice.seller_json || '{}');
  const buyer = JSON.parse(invoice.buyer_json || '{}');
  const items = JSON.parse(invoice.items_json || '[]');
  const cur = invoice.doc_currency || 'EUR';
  const cf = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur });
  const fmt = (n) => cf.format(Number(n) || 0);
  const qf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const stage = invoice.stage || 'full';
  const pdvRate = Number(invoice.pdv_rate) || 0;
  const contentWidth = LETTER_WIDTH - 2 * EN_MARGIN;

  const meta = [
    { text: enTitle(invoice, seller, stage), style: 'title', alignment: 'right' },
    { text: `Invoice No. ${invoice.number}`, alignment: 'right' },
    { text: `Issue date: ${formatDateLong(invoice.issued_on)}`, alignment: 'right' },
    { text: `Due date: ${formatDateLong(invoice.due_on || invoice.issued_on)}`, alignment: 'right', bold: true },
  ];
  if (invoice.supply_date && invoice.supply_date !== invoice.issued_on) {
    meta.push({ text: `Service date: ${formatDateLong(invoice.supply_date)}`, alignment: 'right' });
  }
  if (buyer.sow_ref) meta.push({ text: `Ref: SOW ${buyer.sow_ref}`, alignment: 'right' });

  const from = [
    seller.name_en || seller.name,
    ...lines(seller.address_en || seller.address),
    seller.email, seller.phone,
    seller.pib ? `Tax ID (PIB): ${seller.pib}` : null,
  ];
  const billTo = [
    buyer.name,
    buyer.contact ? `Attn: ${buyer.contact}` : null,
    ...lines(buyer.address),
    buyer.email,
    buyer.pib ? `Tax ID: ${buyer.pib}` : null,
  ];

  const body = [
    [
      { text: 'Description', style: 'th' },
      { text: 'Qty', style: 'th', alignment: 'right' },
      { text: 'Unit price', style: 'th', alignment: 'right' },
      { text: 'Amount', style: 'th', alignment: 'right' },
    ],
    ...items.map((i) => [
      { text: i.description },
      { text: qf.format(i.qty), alignment: 'right' },
      { text: fmt(unitOf(i)), alignment: 'right' },
      { text: fmt(amountOf(i)), alignment: 'right' },
    ]),
  ];
  const totalRow = [{ text: `TOTAL DUE (${cur})`, style: 'totalLabel' }, { text: fmt(totalOf(invoice)), style: 'totalValue', alignment: 'right' }];
  const totals = pdvRate > 0
    ? [
        [{ text: 'Subtotal', style: 'totalLabel' }, { text: fmt(subtotalOf(invoice)), alignment: 'right' }],
        [{ text: `VAT (${qf.format(pdvRate)}%)`, style: 'totalLabel' }, { text: fmt(pdvOf(invoice)), alignment: 'right' }],
        totalRow,
      ]
    : [totalRow];

  const notes = [];
  if (stage === 'deposit') notes.push('Work begins when this deposit is received.');
  if (stage === 'balance') {
    notes.push(invoice.deposit_ref
      ? `Balance due following deposit invoice ${invoice.deposit_ref}.`
      : 'Balance due on completion.');
  }
  if (invoice.note) notes.push(invoice.note);

  let payment;
  if (cur === 'USD') payment = usdPaymentBlock(invoice, seller, buyer);
  else if (seller.bank) payment = [{ text: `Bank account: ${seller.bank}` }, { text: `Payment reference: Invoice ${invoice.number}`, bold: true }];

  return {
    pageSize: 'LETTER',
    pageMargins: [EN_MARGIN, EN_MARGIN, EN_MARGIN, 50],
    watermark: voidMark(invoice, 'VOID'),
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    content: [
      {
        columns: [
          { stack: [{ text: seller.brand || seller.name_en || seller.name || '', style: 'brand' }] },
          { width: 'auto', stack: meta },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 8, x2: contentWidth, y2: 8, lineWidth: 0.5, lineColor: '#cccccc' }], margin: [0, 6, 0, 12] },
      { columns: [partyEn('FROM', from), { width: 20, text: '' }, partyEn('BILL TO', billTo)], margin: [0, 0, 0, 16] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body },
        layout: {
          hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0.2),
          vLineWidth: () => 0,
          hLineColor: () => '#cccccc',
          paddingTop: () => 6, paddingBottom: () => 6,
        },
      },
      {
        columns: [
          { width: '*', text: '' },
          { width: 'auto', table: { widths: ['auto', 'auto'], body: totals }, layout: 'noBorders', margin: [0, 10, 0, 0] },
        ],
      },
      notes.length ? { text: notes.join('\n'), margin: [0, 20, 0, 0] } : {},
      payment ? { stack: [{ text: 'PAYMENT', style: 'partyLabel' }, ...payment], margin: [0, 20, 0, 0], style: 'subtle' } : {},
    ],
    styles: {
      brand: { fontSize: 16, bold: true },
      title: { fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
      subtle: { fontSize: 9, color: '#444444' },
      partyLabel: { fontSize: 8, bold: true, color: '#888888', margin: [0, 0, 0, 3] },
      th: { fontSize: 9, bold: true, color: '#555555' },
      totalLabel: { bold: true, margin: [0, 0, 12, 0] },
      totalValue: { bold: true },
    },
  };
}

/** Download filename: predracun-2026-001.pdf, or Invoice-2026-001-Deimos-Agency.pdf for 'en'. */
export function invoiceFilename(invoice) {
  if (invoice.lang !== 'en') return `${invoice.kind}-${invoice.number}.pdf`;
  const seller = JSON.parse(invoice.seller_json || '{}');
  const slug = String(seller.brand || '').normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `Invoice-${invoice.number}${slug ? `-${slug}` : ''}.pdf`;
}

// Browser-only: lazy-load pdfmake + fonts and trigger the download.
export async function downloadInvoicePdf(invoice) {
  const pdfMake = (await import('pdfmake/build/pdfmake.js')).default;
  const vfs = (await import('pdfmake/build/vfs_fonts.js')).default;
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.createPdf(buildInvoiceDocDefinition(invoice)).download(invoiceFilename(invoice));
}
