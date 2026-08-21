// Builds and downloads a Serbian invoice/proforma PDF from a stored invoice
// record. pdfmake + its font vfs are imported dynamically so they stay out of
// the main bundle — only loaded when you actually click Download.
import { formatDate } from './format.js';

const nf = (min, max) => new Intl.NumberFormat('sr-RS', { minimumFractionDigits: min, maximumFractionDigits: max });
const eur = (n) => `${nf(2, 2).format(n)} €`;
const rsd = (n, rate) => `${nf(2, 2).format(n * rate)} RSD`;

// Render one EUR amount per the invoice's currency mode (rate is snapshotted).
function money(amountEur, currency, rate) {
  if (currency === 'EUR') return eur(amountEur);
  if (currency === 'RSD') return rsd(amountEur, rate);
  return `${rsd(amountEur, rate)}\n(${eur(amountEur)})`; // BOTH
}

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
  const seller = JSON.parse(invoice.seller_json || '{}');
  const buyer = JSON.parse(invoice.buyer_json || '{}');
  const items = JSON.parse(invoice.items_json || '[]');
  const { currency, eur_to_rsd: rate } = invoice;
  const isRacun = invoice.kind === 'racun';
  const title = isRacun ? 'RAČUN' : 'PREDRAČUN';
  const pdvRate = Number(invoice.pdv_rate) || 0;
  const totalEur = invoice.total_eur || invoice.subtotal_eur; // fallback for pre-PDV rows

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
      { text: money(i.unit_eur, currency, rate), alignment: 'right' },
      { text: money(i.amount_eur, currency, rate), alignment: 'right' },
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
  if (currency !== 'EUR') notes.push(`Preračunato po kursu 1 € = ${nf(2, 2).format(rate)} RSD.`);
  if (seller.bank) notes.push(`Uplata na tekući račun: ${seller.bank}   Poziv na broj: ${invoice.number}`);
  if (invoice.note) notes.push(invoice.note);

  const docDefinition = {
    pageSize: 'A4',
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
                    [{ text: 'Osnovica', style: 'totalLabel' }, { text: money(invoice.subtotal_eur, currency, rate), alignment: 'right' }],
                    [{ text: `PDV (${nf(0, 2).format(pdvRate)}%)`, style: 'totalLabel' }, { text: money(invoice.pdv_eur, currency, rate), alignment: 'right' }],
                    [{ text: 'UKUPNO', style: 'totalLabel' }, { text: money(totalEur, currency, rate), style: 'totalValue', alignment: 'right' }],
                  ]
                : [[{ text: 'UKUPNO', style: 'totalLabel' }, { text: money(totalEur, currency, rate), style: 'totalValue', alignment: 'right' }]],
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

// Browser-only: lazy-load pdfmake + fonts and trigger the download.
export async function downloadInvoicePdf(invoice) {
  const pdfMake = (await import('pdfmake/build/pdfmake.js')).default;
  const vfs = (await import('pdfmake/build/vfs_fonts.js')).default;
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.createPdf(buildInvoiceDocDefinition(invoice)).download(`${invoice.kind}-${invoice.number}.pdf`);
}
