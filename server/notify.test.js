import { describe, it, expect, vi } from 'vitest';
import { ntfyConfig, notify } from './notify.js';

describe('ntfyConfig', () => {
  it('needs both URL and topic; token optional; trims the trailing slash', () => {
    expect(ntfyConfig({ NTFY_URL: 'http://ntfy/', NTFY_TOPIC: 'alerts' })).toEqual({ url: 'http://ntfy', topic: 'alerts', token: null });
    expect(ntfyConfig({ NTFY_URL: 'http://ntfy', NTFY_TOPIC: 'a', NTFY_TOKEN: 'tk_x' }).token).toBe('tk_x');
    expect(ntfyConfig({ NTFY_URL: 'http://ntfy' })).toBeNull();
    expect(ntfyConfig({ NTFY_TOPIC: 'a' })).toBeNull();
  });
});

describe('notify', () => {
  const config = { url: 'http://ntfy', topic: 'alerts', token: 'tk_x' };
  it('posts title, priority, tags and bearer token to url/topic', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    expect(await notify({ title: 'Backup FAILED — disk', message: 'boom', tags: ['warning'] }, { config, fetchImpl })).toBe(true);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://ntfy/alerts');
    expect(opts.body).toBe('boom');
    expect(opts.headers).toMatchObject({ Title: 'Backup FAILED - disk', Priority: '4', Tags: 'warning', Authorization: 'Bearer tk_x' });
  });
  it('never throws — unreachable ntfy or HTTP errors just return false', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await notify({ title: 't', message: 'm' }, { config, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } })).toBe(false);
    expect(await notify({ title: 't', message: 'm' }, { config, fetchImpl: async () => ({ ok: false, status: 403 }) })).toBe(false);
    quiet.mockRestore();
  });
  it('is a no-op when not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn();
    expect(await notify({ title: 't', message: 'm' }, { config: null, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
