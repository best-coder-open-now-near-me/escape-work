// The Supabase save client (src/remote-store.js): config parsing, the three
// REST calls' shapes, the inert unconfigured store, and the never-throw
// failure posture. fetch is stubbed - no test touches a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteConfig, createRemoteStore, loadRemoteStore, saveKeyIdentity } from '../../src/remote-store.js';

const CONFIG = { url: 'https://proj.supabase.co', anonKey: 'anon-key' };

const stubFetch = (responses) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = responses.shift() || { ok: true, json: [] };
    return { ok: r.ok !== false, status: r.status ?? (r.ok !== false ? 200 : 400), json: async () => r.json ?? [] };
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
  const s = createRemoteStore({ config: CONFIG, identity: 'dev-1', fetchFn: f });
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
  const s = createRemoteStore({ config: CONFIG, identity: 'dev-1', fetchFn: f });
  assert.deepEqual(await s.pull(), { data: { levelId: 'level2' }, updatedAt: 't1' });
  assert.match(f.calls[0].url, /saves\?device_id=eq\.dev-1&select=data,updated_at/);

  const empty = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: stubFetch([{ ok: true, json: [] }]) });
  assert.equal(await empty.pull(), null);
  const bad = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: stubFetch([{ ok: false }]) });
  assert.equal(await bad.pull(), null);
  const dead = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: async () => { throw new Error('offline'); } });
  assert.equal(await dead.pull(), null);
});

test('clear deletes exactly this device row and never throws', async () => {
  const f = stubFetch([{ ok: true }]);
  const s = createRemoteStore({ config: CONFIG, identity: 'dev 1', fetchFn: f });
  assert.equal(await s.clear(), true);
  assert.equal(f.calls[0].opts.method, 'DELETE');
  assert.match(f.calls[0].url, /device_id=eq\.dev%201/); // ids are URL-encoded
  const dead = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: async () => { throw new Error('offline'); } });
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

test('a save key digests to a stable local identity, promises welcome', async () => {
  const a = await saveKeyIdentity('  my secret phrase ');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await saveKeyIdentity('my secret phrase')); // trimmed, stable
  assert.notEqual(a, await saveKeyIdentity('my other phrase'));
  // The store accepts the digest as a promise and awaits it per route.
  const f = stubFetch([{ ok: true }]);
  const s = createRemoteStore({ config: CONFIG, identity: saveKeyIdentity('k'), fetchFn: f });
  await s.push({ levelId: 'level1' });
  assert.equal(JSON.parse(f.calls[0].opts.body)[0].device_id, await saveKeyIdentity('k'));
});

test('a stored save key outranks the device id as the identity', async () => {
  const mem = new Map([
    ['escape-work.remote', JSON.stringify(CONFIG)],
    ['escape-work.save-key', 'phrase'],
    ['escape-work.device', 'dev-uuid'],
  ]);
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const f = stubFetch([{ ok: true, json: [] }]);
  await loadRemoteStore(st, f).pull();
  assert.match(f.calls[0].url, new RegExp(await saveKeyIdentity('phrase')));
});

test('trouble is classified: paused (540), rejected (4xx), unreachable', async () => {
  const kinds = [];
  const mk = (responses) => createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: stubFetch(responses), onTrouble: (k) => kinds.push(k) });
  await mk([{ ok: false, status: 540 }]).pull();
  await mk([{ ok: false, status: 401 }]).push({});
  await mk([{ ok: false, status: 503 }]).clear();
  const dead = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: async () => { throw new Error('x'); },
    onTrouble: (k) => kinds.push(k) });
  await dead.pull();
  assert.deepEqual(kinds, ['paused', 'rejected', 'unreachable', 'unreachable']);
  const fine = createRemoteStore({
    config: CONFIG, identity: 'dev-1', fetchFn: stubFetch([{ ok: true, json: [] }]),
    onTrouble: (k) => kinds.push(k) });
  await fine.pull();
  assert.equal(kinds.length, 4); // a healthy call reports nothing
});
