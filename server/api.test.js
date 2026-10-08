// API tests: the real Express app against an in-memory SQLite DB. The NBS
// lookup is replaced with a fake, so nothing touches the network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';
delete process.env.REV_TRACKER_PASSWORD; // auth off, as in local dev

let server;
let base;
let nbsCalls = 0;

beforeAll(async () => {
  const { app, setNbsFetch } = await import('./app.js');
  setNbsFetch(async () => {
    nbsCalls++;
    return { ok: true, json: async () => ({ exchange_middle: 100 }) };
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
afterAll(() => server?.close());

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ok = async (...args) => {
  const r = await api(...args);
  if (r.status >= 400) throw new Error(`${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const boot = () => ok('GET', '/bootstrap');
const project = (over = {}) => ok('POST', '/projects', { name: `P${Math.random()}`, ...over });
const charge = (projectId, over = {}) => ok('POST', '/charges', {
  project_id: projectId, direction: 'income', amount: 1000, label: 'Build', ...over,
});

describe('invoices', () => {
  it('numbers sequentially per year and never reuses a voided number', async () => {
    const p = await project();
    const item = [{ description: 'Site', qty: 1, unit: 100 }];
    const a = await ok('POST', '/invoices', { project_id: p.id, items: item });
    const b = await ok('POST', '/invoices', { project_id: p.id, items: item });
    expect(Number(b.number.slice(5))).toBe(Number(a.number.slice(5)) + 1);
    await ok('POST', `/invoices/${b.id}/void`);
    const c = await ok('POST', '/invoices', { project_id: p.id, items: item });
    expect(Number(c.number.slice(5))).toBe(Number(b.number.slice(5)) + 1);
    expect((await api('DELETE', `/invoices/${a.id}`)).status).toBe(404); // no hard delete
  });

  it('issues a predračun until a PIB is set, then a račun', async () => {
    const p = await project();
    const items = [{ description: 'Site', qty: 1, unit: 100 }];
    expect((await ok('POST', '/invoices', { project_id: p.id, items })).kind).toBe('predracun');
    await ok('PUT', '/settings', { seller_pib: '111222333' });
    try {
      expect((await ok('POST', '/invoices', { project_id: p.id, items })).kind).toBe('racun');
    } finally {
      await ok('PUT', '/settings', { seller_pib: '' });
    }
  });

  it('rejects negative quantities and prices', async () => {
    const p = await project();
    const r1 = await api('POST', '/invoices', { project_id: p.id, items: [{ description: 'x', qty: -1, unit: 100 }] });
    const r2 = await api('POST', '/invoices', { project_id: p.id, items: [{ description: 'x', qty: 1, unit: -100 }] });
    expect([r1.status, r2.status]).toEqual([400, 400]);
  });

  it('a deposit leaves the charge open; the paid balance closes it', async () => {
    const p = await project({ client_country: 'US', currency: 'USD', client_type: 'individual' });
    const c = await charge(p.id, { amount: 2400 });
    const dep = await ok('POST', '/invoices', { project_id: p.id, stage: 'deposit', items: [{ description: 'Deposit', qty: 1, unit: 1200, charge_id: c.id }] });
    await ok('POST', `/invoices/${dep.id}/payments`, {});
    expect((await boot()).charges.find((x) => x.id === c.id).active).toBe(1);
    const bal = await ok('POST', '/invoices', { project_id: p.id, stage: 'balance', deposit_ref: dep.number, items: [{ description: 'Balance', qty: 1, unit: 1200, charge_id: c.id }] });
    await ok('POST', `/invoices/${bal.id}/payments`, {});
    expect((await boot()).charges.find((x) => x.id === c.id).active).toBe(0);
  });
});

describe('charges', () => {
  it('paying a monthly charge logs it and advances next_due', async () => {
    const p = await project();
    const c = await charge(p.id, { amount: 50, frequency: 'monthly', next_due: '2026-09-15' });
    const r = await ok('POST', `/charges/${c.id}/pay`, { paid_on: '2026-09-15' });
    expect(r.charge.next_due).toBe('2026-10-15');
    expect(r.payment).toMatchObject({ amount: 50, charge_period: '2026-09-15' });
  });

  it('pays in parts and closes only once fully covered (50/50)', async () => {
    const p = await project();
    const c = await charge(p.id, { amount: 2400, next_due: '2026-10-01' });
    const first = await ok('POST', `/charges/${c.id}/pay`, { amount: 1200 });
    expect(first.charge.active).toBe(1);
    expect(first.payment.note).toMatch(/^Part payment/);
    expect((await api('POST', `/charges/${c.id}/pay`, { amount: 1500 })).status).toBe(400); // more than left
    const second = await ok('POST', `/charges/${c.id}/pay`, {}); // defaults to the remaining 1200
    expect(second.payment.amount).toBe(1200);
    expect(second.charge.active).toBe(0);
    expect((await api('POST', `/charges/${c.id}/pay`, {})).status).toBe(400); // closed
  });

  it('a partly paid recurring charge advances only when the period is covered', async () => {
    const p = await project();
    const c = await charge(p.id, { amount: 100, frequency: 'monthly', next_due: '2026-09-01' });
    expect((await ok('POST', `/charges/${c.id}/pay`, { amount: 40 })).charge.next_due).toBe('2026-09-01');
    expect((await ok('POST', `/charges/${c.id}/pay`, { amount: 60 })).charge.next_due).toBe('2026-10-01');
    // the new period starts from zero
    expect((await ok('POST', `/charges/${c.id}/pay`, { amount: 40 })).charge.next_due).toBe('2026-10-01');
  });

  it('rejects negative amounts and coerces string ids', async () => {
    const p = await project();
    expect((await api('POST', '/charges', { project_id: p.id, direction: 'income', amount: -5 })).status).toBe(400);
    expect((await api('POST', '/charges', { project_id: String(p.id), direction: 'income', amount: 5 })).status).toBe(201);
    const c = await charge(p.id);
    expect((await api('PUT', `/charges/${c.id}`, { amount: -1 })).status).toBe(400);
    expect((await api('POST', '/overheads', { label: 'x', amount: -1 })).status).toBe(400);
    expect((await api('POST', '/payments', { project_id: p.id, direction: 'income', amount: -1 })).status).toBe(400);
  });
});

describe('payments', () => {
  it('records every edit and delete in the audit log', async () => {
    const p = await project();
    const pay = await ok('POST', '/payments', { project_id: p.id, direction: 'income', amount: 500, paid_on: '2026-09-01' });
    await ok('PUT', `/payments/${pay.id}`, { amount: 450, paid_on: '2026-09-02', note: pay.note });
    let log = (await boot()).audit_log.filter((a) => a.entity === 'payment' && a.entity_id === pay.id);
    expect(log.map((a) => [a.field, a.old, a.new]).sort()).toEqual([
      ['amount', '500', '450'],
      ['paid_on', '2026-09-01', '2026-09-02'],
    ]);
    await ok('PUT', `/payments/${pay.id}`, { amount: 450 }); // no change → no rows
    await ok('DELETE', `/payments/${pay.id}`);
    log = (await boot()).audit_log.filter((a) => a.entity === 'payment' && a.entity_id === pay.id);
    expect(log).toHaveLength(3);
    expect(JSON.parse(log.find((a) => a.field === '(deleted)').old).amount).toBe(450);
  });

  it('fills the NBS rate for a foreign payment (fake fetch)', async () => {
    const p = await project({ client_country: 'US', currency: 'USD' });
    const before = nbsCalls;
    const pay = await ok('POST', '/payments', { project_id: p.id, direction: 'income', amount: 1000, paid_on: '2026-09-01' });
    expect(pay).toMatchObject({ channel: 'payoneer_receiving_ach', nbs_rate_rsd: 100, amount_rsd: 100000 });
    expect(nbsCalls).toBe(before + 1);
  });
});

describe('project delete guard', () => {
  it('refuses to delete a project with payments — archive instead', async () => {
    const p = await project();
    await ok('POST', '/payments', { project_id: p.id, direction: 'income', amount: 100 });
    const r = await api('DELETE', `/projects/${p.id}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/archive it instead/);
    expect((await boot()).payments.some((x) => x.project_id === p.id)).toBe(true);
  });

  it('refuses when the project has invoices', async () => {
    const p = await project();
    await ok('POST', '/invoices', { project_id: p.id, items: [{ description: 'x', qty: 1, unit: 1 }] });
    expect((await api('DELETE', `/projects/${p.id}`)).status).toBe(400);
  });

  it('still deletes a project with no money history', async () => {
    const p = await project();
    await charge(p.id);
    expect((await api('DELETE', `/projects/${p.id}`)).status).toBe(200);
    expect((await boot()).projects.some((x) => x.id === p.id)).toBe(false);
  });
});
