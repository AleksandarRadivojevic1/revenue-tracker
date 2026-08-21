// Display helpers. All stored amounts are EUR; RSD is derived via the rate.

export function formatMoney(amountEur, settings) {
  const cur = settings?.display_currency || 'EUR';
  if (cur === 'RSD') {
    const rsd = amountEur * (settings?.eur_to_rsd || 0);
    return new Intl.NumberFormat('sr-RS', {
      style: 'currency',
      currency: 'RSD',
      maximumFractionDigits: 0,
    }).format(rsd);
  }
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(amountEur);
}

export function formatDate(iso) {
  if (!iso) return '—';
  // Serbian day-first numeric format: dd/mm/yyyy (en-GB gives exactly this).
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export const STATUS_META = {
  paid: { label: 'Paid', tone: 'mint' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  due_soon: { label: 'Due soon', tone: 'amber' },
  overdue: { label: 'Overdue', tone: 'red' },
};

export const FREQUENCY_LABEL = {
  one_time: 'One-time',
  monthly: '/mo',
  yearly: '/yr',
};
