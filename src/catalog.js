// Service catalog — mirrors the real offer at alexrad.dev.
// Prices are "from" figures (EUR) and are always editable when creating a charge.

export const MAINTENANCE_TIERS = {
  website: { label: 'Website', monthly: 50, yearly: 540 },
  webapp: { label: 'Web app', monthly: 120, yearly: 1290 },
};

export const PACKAGES = [
  {
    key: 'start',
    name: 'Start',
    tagline: 'Mini site — storefront',
    build: 450,
    tier: 'website',
    accent: 'green',
  },
  {
    key: 'standard',
    name: 'Standard',
    tagline: 'Full site',
    build: 900,
    tier: 'website',
    accent: 'blue',
    popular: true,
  },
  {
    key: 'plus',
    name: 'Plus',
    tagline: 'Site with booking + reminders',
    build: 1400,
    tier: 'website',
    accent: 'orange',
  },
  {
    key: 'webapp',
    name: 'Web app',
    tagline: 'Custom application',
    build: 3000,
    tier: 'webapp',
    accent: 'violet',
  },
];

export const PACKAGE_BY_KEY = Object.fromEntries(PACKAGES.map((p) => [p.key, p]));

// A struck-at-custom-price deal — no fixed catalog price.
export const CUSTOM_PACKAGE = { key: 'custom', name: 'Custom', tagline: 'Custom deal', accent: 'orange' };

// Meta for rendering a package pill from a stored key (real or custom).
export function packageMeta(key) {
  if (!key) return null;
  return PACKAGE_BY_KEY[key] || (key === CUSTOM_PACKAGE.key ? CUSTOM_PACKAGE : null);
}

// Client-requested add-ons / features.
export const ADDONS = [
  { key: 'i18n', label: 'Extra language version', amount: 250, frequency: 'one_time', category: 'feature' },
  { key: 'seo_advanced', label: 'Advanced SEO (one-time)', amount: 250, frequency: 'one_time', category: 'feature' },
  { key: 'seo_local', label: 'Ongoing local SEO', amount: 300, frequency: 'monthly', category: 'feature' },
  { key: 'copy_photo', label: 'Copy & photography', amount: 0, frequency: 'one_time', category: 'feature', byAgreement: true },
];

// Typical per-site expenses (what I spend). Amounts are blank by default.
export const EXPENSE_CATEGORIES = [
  { key: 'hosting', label: 'Hosting' },
  { key: 'domain', label: 'Domain' },
  { key: 'tool', label: 'Tool / subscription' },
  { key: 'other', label: 'Other' },
];

// Out-of-project costs (business overhead not tied to a client project).
export const OVERHEAD_CATEGORIES = [
  { key: 'tool', label: 'Tool / subscription' },
  { key: 'hosting', label: 'Hosting' },
  { key: 'domain', label: 'Domain' },
  { key: 'other', label: 'Other' },
];

// Quick-add presets for common recurring costs. Amounts are editable.
export const OVERHEAD_PRESETS = [
  { key: 'claude', label: 'Claude Code', category: 'tool', amount: 17, frequency: 'monthly' },
  { key: 'hosting', label: 'Hosting', category: 'hosting', amount: 5, frequency: 'monthly' },
  { key: 'domain', label: 'Domain', category: 'domain', amount: 12, frequency: 'yearly' },
];

export const INCOME_CATEGORIES = [
  { key: 'build', label: 'Build' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'feature', label: 'Feature / add-on' },
  { key: 'other', label: 'Other' },
];

export const FREQUENCIES = [
  { key: 'one_time', label: 'One-time' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];
