import { describe, it, expect, vi } from 'vitest';
import { createNbsClient, parseNbsRate } from './nbs.js';

const memCache = () => {
  const m = new Map();
  return { get: (c, d) => m.get(`${c}:${d}`), set: (c, d, r) => m.set(`${c}:${d}`, r), m };
};
const okFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));

describe('nbs rates', () => {
  it('parses the middle rate', () => {
    expect(parseNbsRate({ exchange_middle: 104.4027 })).toBe(104.4027);
    expect(() => parseNbsRate({})).toThrow();
  });

  it('fetches, then serves past dates from the cache', async () => {
    const fetchImpl = okFetch({ code: 'USD', exchange_middle: 104.4027 });
    const cache = memCache();
    const rate = createNbsClient({ fetchImpl, cache, today: () => '2026-10-08' });
    expect(await rate('USD', '2026-10-04')).toBe(104.4027);
    expect(await rate('USD', '2026-10-04')).toBe(104.4027);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://kurs.resenje.org/api/v1/currencies/usd/rates/2026-10-04');
  });

  it("doesn't cache today's rate (the list may not be out yet)", async () => {
    const fetchImpl = okFetch({ exchange_middle: 117.4 });
    const cache = memCache();
    const rate = createNbsClient({ fetchImpl, cache, today: () => '2026-10-08' });
    await rate('EUR', '2026-10-08');
    expect(cache.m.size).toBe(0);
  });

  it('RSD is 1 with no lookup; future dates and HTTP errors throw', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    const rate = createNbsClient({ fetchImpl, cache: memCache(), today: () => '2026-10-08' });
    expect(await rate('RSD', '2026-10-01')).toBe(1);
    await expect(rate('USD', '2026-10-09')).rejects.toThrow(/future/);
    await expect(rate('USD', '2026-10-01')).rejects.toThrow(/503/);
  });
});
