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
// pull reports null, and the caller's local write already happened. The one
// concession to visibility is `onTrouble(kind)`: the host gets told WHY the
// cloud is failing - 'paused' (HTTP 540, Supabase's project-paused code),
// 'rejected' (4xx: key/table/policy) or 'unreachable' (5xx, no network) -
// so it can warn instead of shrugging in silence (designer, 2026-08-01:
// "make sure to throw up a warning if its paused").

const CONFIG_KEY = 'escape-work.remote';
const DEVICE_KEY = 'escape-work.device';
// The game's own project (designer, 2026-08-01) - shipped so nobody types a
// URL. The anon key is DESIGNED to ship in clients (row-level security is
// the fence); it stays blank here until the designer provides it, and until
// then the store is inert unless localStorage supplies one.
export const SHIPPED_REMOTE = {
  url: 'https://ijckmyywjtzdnbrkzqah.supabase.co',
  anonKey: '',
};
export const SAVE_KEY_STORAGE = 'escape-work.save-key';

// A user-chosen save key -> the cloud row identity (designer, 2026-08-01:
// "a key they will use locally as their save key so i dont have to sweat
// someone messing with my stuff"). The phrase is digested locally and only
// the SHA-256 hex ever goes over the wire or into the table - someone
// browsing the rows learns nothing, and stomping a row means guessing a
// whole phrase, not picking a uuid off a list. Not encryption, and not
// claimed to be: a fence, like a dreamlo board's secret. Same phrase on
// another browser = same identity, so the key is also how a run follows
// its owner across machines.
export async function saveKeyIdentity(key) {
  const bytes = new TextEncoder().encode('escape-work:' + String(key).trim());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Config JSON (+ optional shipped defaults) -> { url, anonKey } or null.
// Stored fields win over defaults field-by-field, so a browser can supply
// just the anon key against the shipped URL. Tolerates a trailing slash AND
// a pasted "/rest/v1" suffix - the client appends that path itself, and the
// dashboard's copy button hands people exactly that form. Anything still
// missing a piece is null rather than half-working.
export function parseRemoteConfig(json, defaults = null) {
  let c = null;
  if (json) {
    try {
      c = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
      c = null; // unreadable stored config reads as absent, not as a veto
    }
  }
  if (!c && !defaults) return null;
  const rawUrl = (typeof c?.url === 'string' && c.url) || defaults?.url || '';
  const anonKey = ((typeof c?.anonKey === 'string' && c.anonKey) || defaults?.anonKey || '').trim();
  const url = rawUrl.replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url) || !anonKey) return null;
  return { url, anonKey };
}

// The store. `config` from parseRemoteConfig (null -> inert). `identity` is
// whose saves these are - a minted device id, or a hashed save key (possibly
// still hashing: a promise is fine, every route awaits it). `fetchFn`
// injectable so tests never touch a network.
export function createRemoteStore({ config = null, identity = '', fetchFn = null, onTrouble = null } = {}) {
  if (!config || !identity) {
    return {
      enabled: false,
      pull: async () => null,
      push: async () => false,
      clear: async () => false,
    };
  }
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  // res = null means the fetch itself threw (offline, DNS, CORS).
  const report = (res) => {
    if (!onTrouble) return;
    if (!res) onTrouble('unreachable');
    else if (res.status === 540) onTrouble('paused'); // Supabase: project paused
    else if (res.status >= 500) onTrouble('unreachable');
    else onTrouble('rejected');
  };
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    'Content-Type': 'application/json',
  };
  // All access goes through RPC functions, never table routes (the base
  // minimum, designer 2026-08-01): the database demands the exact row
  // identity, so rows can't be listed or blanket-written even with the
  // shipped key, and it enforces the size cap and the global row backstop
  // where no client can argue. REMOTE_STORE.md carries the SQL.
  const rpc = async (fn, body) => doFetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return {
    enabled: true,
    // The newest save pushed under this device id, as { data, updatedAt },
    // or null (no row, no network, no project - all the same to the caller).
    async pull() {
      try {
        const res = await rpc('save_get', { p_id: await identity });
        if (!res.ok) { report(res); return null; }
        const row = await res.json();
        return row?.data ? { data: row.data, updatedAt: row.updated_at } : null;
      } catch {
        report(null);
        return null;
      }
    },
    // Upsert this device's save. Fire-and-forget at the call site: the local
    // write already succeeded, so the cloud copy is strictly a bonus.
    async push(data) {
      try {
        const res = await rpc('save_put', { p_id: await identity, p_data: data });
        if (!res.ok) report(res);
        return res.ok;
      } catch {
        report(null);
        return false;
      }
    },
    // A restarted run retires its cloud copy too, or the desk would offer a
    // ghost of the save the player deliberately abandoned.
    async clear() {
      try {
        const res = await rpc('save_del', { p_id: await identity });
        if (!res.ok) report(res);
        return res.ok;
      } catch {
        report(null);
        return false;
      }
    },
  };
}

// Browser convenience: config + identity out of storage, inert store when
// either is unavailable (no config painted yet, private mode, quota). A
// save key, when set, IS the identity; without one the browser falls back
// to a minted device id - which never regenerates while a stored one
// exists, because it is the only pointer to that browser's cloud row.
export function loadRemoteStore(storage = null, fetchFn = null, onTrouble = null) {
  try {
    const st = storage || globalThis.localStorage;
    const config = parseRemoteConfig(st.getItem(CONFIG_KEY), SHIPPED_REMOTE);
    if (!config) return createRemoteStore();
    const saveKey = (st.getItem(SAVE_KEY_STORAGE) || '').trim();
    let identity;
    if (saveKey) {
      identity = saveKeyIdentity(saveKey);
    } else {
      identity = st.getItem(DEVICE_KEY);
      if (!identity) {
        identity = globalThis.crypto.randomUUID();
        st.setItem(DEVICE_KEY, identity);
      }
    }
    return createRemoteStore({ config, identity, fetchFn, onTrouble });
  } catch {
    return createRemoteStore();
  }
}
