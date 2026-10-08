// NBS middle exchange rates (currency → RSD) for the tax base. Fetched from
// kurs.resenje.org, a free JSON mirror of the NBS kursna lista: for any date it
// returns the list in effect that day (weekends/holidays → previous list).
// The fetch and the cache are injected so this stays unit-testable.

const API = 'https://kurs.resenje.org/api/v1/currencies';

/** Pull the middle rate out of an API response; throws if it isn't there. */
export function parseNbsRate(json) {
  const rate = Number(json?.exchange_middle);
  if (!(rate > 0)) throw new Error('NBS rate missing from response');
  return rate;
}

/**
 * cache: { get(currency, date) → rate|undefined, set(currency, date, rate) }.
 * Only past dates are cached — today's list may not be published yet, and a
 * cached "yesterday's rate" for today would stick forever.
 */
export function createNbsClient({ fetchImpl = fetch, cache, today, timeoutMs = 4000 }) {
  return async function nbsRate(currency, date) {
    if (currency === 'RSD') return 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('date must be YYYY-MM-DD');
    if (date > today()) throw new Error('no NBS rate for a future date');
    const hit = cache.get(currency, date);
    if (hit) return hit;
    const res = await fetchImpl(`${API}/${currency.toLowerCase()}/rates/${date}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`NBS rate lookup failed (HTTP ${res.status})`);
    const rate = parseNbsRate(await res.json());
    if (date < today()) cache.set(currency, date, rate);
    return rate;
  };
}
