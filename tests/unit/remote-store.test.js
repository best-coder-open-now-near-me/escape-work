// The Supabase save client (src/remote-store.js): config parsing, the three
// REST calls' shapes, the inert unconfigured store, and the never-throw
// failure posture. fetch is stubbed - no test touches a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteConfig, createRemoteStore, loadRemoteStore } from '../../src/remote-store.js';

const CONFIG = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };

const stubFetch = (responses) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = responses.shift() || { ok: true, json: [] };
    return { ok: r.ok !== false, json: async () => r.json ?? [] };
  };
  fn.calls = calls;
  return fn;
};

test('config parsing tolerates a trailing slash and rejects half-configs', () => {
  assert.deepEqual(parseRemoteConfig('{"url":"https://x.co/","anonKey":"k"}'),
    { url: 'https://x.co', anonKey: 'k' });
  assert.equal(parseRemoteConfig(null), null);
  assert.equal(parseRemoteConfig('not json'), null);
  assert.equal(parseRemoteConfig('{"url":"https://x.co"}'), null);
  assert.equal(parseRemoteConfig('{"anonKey":"k"}'), null);
  assert.equal(parseRemoteConfig('{"url":"ftp://x.co","anonKey":"k"}'), null);
});

test('unconfigured store is inert on every route', async () => {
  const s = createRemoteStore();
  assert.equal(s.enabled, false);
  assert.equal(await s.pull(), null);
  assert.equal(await s.push({ hp: 1 }), false);
  assert.equal(await s.clear(), false);
});

test('push upserts this device row with both auth headers', async () => {
  const f = stubFetch([{ ok: true }]);
  const s = createRemoteStore({ config: CONFIG, deviceId: 'dev-1', fetchFn: f });
  assert.equal(await s.push({ levelId: 'level2' }), true);
  const { url, opts } = f.calls[0];
  assert.equal(url, 'https://proj.supabase.co/rest/v1/saves');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.apikey, 'anon-key');
  assert.equal(opts.headers.Authorization, 'Bearer anon-key');
  assert.match(opts.headers.Prefer, /merge-duplicates/);
  const body = JSON.parse(opts.body);
  assert.equal(body[0].device_id, 'dev-1');
  assert.deepEqual(body[0].data, { levelId: 'level2' });
  assert.ok(body[0].updated_at);
});

test('pull returns the row, and null for empty / non-ok / thrown', async () => {
  const f = stubFetch([{ ok: true, json: [{ data: { levelId: 'level2' }, updated_at: 't1' }] }]);
  const s = createRemoteStore({ config: CONFIG, deviceId: 'dev-1', fetchFn: f });
  assert.deepEqual(await s.pull(), { data: { levelId: 'level2' }, updatedAt: 't1' });
  assert.match(f.calls[0].url, /saves\?device_id=eq\.dev-1&select=data,updated_at/);

  const empty = createRemoteStore({
    config: CONFIG, deviceId: 'dev-1', fetchFn: stubFetch([{ ok: true, json: [] }]) });
  assert.equal(await empty.pull(), null);
  const bad = createRemoteStore({
    config: CONFIG, deviceId: 'dev-1', fetchFn: stubFetch([{ ok: false }]) });
  assert.equal(await bad.pull(), null);
  const dead = createRemoteStore({
    config: CONFIG, deviceId: 'dev-1', fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(await dead.pull(), null);
});

test('clear deletes exactly this device row and never throws', async () => {
  const f = stubFetch([{ ok: true }]);
  const s = createRemoteStore({ config: CONFIG, deviceId: 'dev 1', fetchFn: f });
  assert.equal(await s.clear(), true);
  assert.equal(f.calls[0].opts.method, 'DELETE');
  assert.match(f.calls[0].url, /device_id=eq\.dev%201/); // ids are URL-encoded
  const dead = createRemoteStore({
    config: CONFIG, deviceId: 'dev-1', fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(await dead.clear(), false);
});

test('loadRemoteStore mints one device id and then keeps it', () => {
  const mem = new Map([['escape-work.remote', JSON.stringify(CONFIG)]]);
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = loadRemoteStore(st);
  assert.equal(a.enabled, true);
  const minted = mem.get('escape-work.device');
  assert.ok(minted);
  loadRemoteStore(st);
  assert.equal(mem.get('escape-work.device'), minted); // reused, never rerolled
});

test('loadRemoteStore is inert without config or without storage', () => {
  const st = { getItem: () => null, setItem: () => {} };
  assert.equal(loadRemoteStore(st).enabled, false);
  assert.equal(loadRemoteStore({ getItem: () => { throw new Error('blocked'); } }).enabled, false);
});
