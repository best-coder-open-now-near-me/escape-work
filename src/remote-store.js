// Cloud saves on Supabase (REMOTE_STORE.md; designer picked Supabase,
// 2026-08-01). This is the whole client: plain fetch against PostgREST, no
// SDK - two headers and three routes do not justify a dependency in a
// code-first repo. The store sits BEHIND the local save, never in front of
// it: localStorage stays the source of truth the boot path reads, the cloud
// is the carrier that lets a save outlive a browser. Unconfigured, every
// call is an inert no-op and the game cannot tell the module is here.
//
// Failure posture: a dead network, a paused free-tier project, a bad key -
// none of it may cost a run. Nothing here throws; push/clear report false,
// pull reports null, and the caller's local write already happened.

const CONFIG_KEY = 'escape-work.remote';
const DEVICE_KEY = 'escape-work.device';
const TABLE = 'saves';

// Config JSON -> { url, anonKey } or null. Tolerates a trailing slash on the
// url; rejects anything that lacks either field rather than half-working.
export function parseRemoteConfig(json) {
  if (!json) return null;
  try {
    const c = typeof json === 'string' ? JSON.parse(json) : json;
    if (!c || typeof c.url !== 'string' || typeof c.anonKey !== 'string') return null;
    const url = c.url.replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url) || !c.anonKey.trim()) return null;
    return { url, anonKey: c.anonKey.trim() };
  } catch {
    return null;
  }
}

// The store. `config` from parseRemoteConfig (null -> inert), `deviceId` is
// this browser's stable identity, `fetchFn` injectable so tests never touch
// a network.
export function createRemoteStore({ config = null, deviceId = '', fetchFn = null } = {}) {
  if (!config || !deviceId) {
    return {
      enabled: false,
      pull: async () => null,
      push: async () => false,
      clear: async () => false,
    };
  }
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    'Content-Type': 'application/json',
  };
  const rowUrl = `${config.url}/rest/v1/${TABLE}?device_id=eq.${encodeURIComponent(deviceId)}`;
  return {
    enabled: true,
    // The newest save pushed under this device id, as { data, updatedAt },
    // or null (no row, no network, no project - all the same to the caller).
    async pull() {
      try {
        const res = await doFetch(`${rowUrl}&select=data,updated_at`, { headers });
        if (!res.ok) return null;
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        return row ? { data: row.data, updatedAt: row.updated_at } : null;
      } catch {
        return null;
      }
    },
    // Upsert this device's save. Fire-and-forget at the call site: the local
    // write already succeeded, so the cloud copy is strictly a bonus.
    async push(data) {
      try {
        const res = await doFetch(`${config.url}/rest/v1/${TABLE}`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{ device_id: deviceId, data, updated_at: new Date().toISOString() }]),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    // A restarted run retires its cloud copy too, or the desk would offer a
    // ghost of the save the player deliberately abandoned.
    async clear() {
      try {
        const res = await doFetch(rowUrl, { method: 'DELETE', headers });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

// Browser convenience: config + device identity out of storage, inert store
// when either is unavailable (no config painted yet, private mode, quota).
// The device id is minted once and reused - it IS the save's key, so losing
// it means the cloud row is orphaned, which is why it never regenerates
// while a stored one exists.
export function loadRemoteStore(storage = null, fetchFn = null) {
  try {
    const st = storage || globalThis.localStorage;
    const config = parseRemoteConfig(st.getItem(CONFIG_KEY));
    if (!config) return createRemoteStore();
    let deviceId = st.getItem(DEVICE_KEY);
    if (!deviceId) {
      deviceId = globalThis.crypto.randomUUID();
      st.setItem(DEVICE_KEY, deviceId);
    }
    return createRemoteStore({ config, deviceId, fetchFn });
  } catch {
    return createRemoteStore();
  }
}
