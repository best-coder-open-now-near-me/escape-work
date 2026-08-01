# Remote Saves — Supabase

Cloud campaign saves behind the local ones. Supabase chosen by the designer
`[stated]` ("supabase sounds good, lets do it", 2026-08-01) after the free-tier
comparison (500MB Postgres, 50k MAU, REST from the browser). The client is
`src/remote-store.js` — plain fetch against PostgREST, no SDK — and the game
runs identically with it unconfigured.

## How it behaves

- **Local wins.** `localStorage` stays the save the boot path reads. The cloud
  is a carrier: every floor-clear save also upserts one row keyed by a
  per-browser device id; Restart run deletes both copies.
- **Restore happens at the floor-select desk.** With no local save, the desk
  quietly asks the cloud; if a save exists, a "Continue the run — restored
  from the cloud" button appears above the floor list. Clicking banks it
  locally and reboots through the normal restore path.
- **Your save key is your identity** (designer, 2026-08-01: "a key they will
  use locally as their save key so i dont have to sweat someone messing with
  my stuff"). The floor-select desk has a field for a private phrase; it is
  SHA-256-digested locally and only the digest ever goes over the wire or
  into the table, so nobody browsing rows learns it and stomping your row
  means guessing your whole phrase. The same phrase on another browser picks
  up the same saves — the key is also how a run follows its owner across
  machines. No key set → a per-browser random device id, as before. A fence,
  not encryption: pick a phrase, not "save".
- **Failure warns once, then stays quiet.** Dead network, bad key, paused
  project — pushes report false, pulls report null, and the first failure of
  a session raises one toast worded by cause. A paused free-tier project is
  detected precisely (Supabase answers HTTP 540 for it) and the warning says
  to wake it in the dashboard; 4xx failures point at the key/table setup.

## One-time project setup

1. Create a project at supabase.com (free tier), then in the SQL editor run
   the block below. This is the **base-minimum abuse posture** the designer
   asked for (2026-08-01, "i wanted the base minimum"): the table is not
   reachable directly at all — no listing rows, no blanket writes, even with
   the shipped anon key. All access goes through three functions that demand
   the exact row identity, and the database itself enforces a 32KB cap per
   save and a 5,000-row backstop so scripted junk can't balloon the free
   tier. What this deliberately does NOT do (deferred with the level-sharing
   milestone): per-person creation quotas, which need server-minted
   identities (anonymous auth + captcha) to mean anything.

   ```sql
   create table public.saves (
     device_id  text primary key,
     data       jsonb not null,
     updated_at timestamptz not null default now()
   );
   alter table public.saves enable row level security;
   -- No policies on purpose: anon cannot touch the table directly.

   create or replace function public.save_get(p_id text)
   returns jsonb language sql security definer set search_path = public as $$
     select jsonb_build_object('data', data, 'updated_at', updated_at)
     from saves where device_id = p_id;
   $$;

   create or replace function public.save_put(p_id text, p_data jsonb)
   returns void language plpgsql security definer set search_path = public as $$
   begin
     if length(p_id) < 8 or length(p_id) > 128 then
       raise exception 'bad save id';
     end if;
     if pg_column_size(p_data) > 32768 then
       raise exception 'save too large';
     end if;
     if not exists (select 1 from saves where device_id = p_id)
        and (select count(*) from saves) >= 5000 then
       raise exception 'save table full';
     end if;
     insert into saves (device_id, data, updated_at)
     values (p_id, p_data, now())
     on conflict (device_id) do update
       set data = excluded.data, updated_at = now();
   end;
   $$;

   create or replace function public.save_del(p_id text)
   returns void language sql security definer set search_path = public as $$
     delete from saves where device_id = p_id;
   $$;

   revoke all on table public.saves from anon, authenticated;
   revoke execute on function public.save_get(text),
     public.save_put(text, jsonb), public.save_del(text) from public;
   grant execute on function public.save_get(text),
     public.save_put(text, jsonb), public.save_del(text) to anon;
   ```

   This is also what makes the save-key promise airtight: with no way to
   list rows, "messing with someone's stuff" requires their exact identity —
   a random UUID or the digest of a whole phrase — not a browse.

2. The project URL is already shipped in the game (`SHIPPED_REMOTE`,
   src/remote-store.js — the designer's project, 2026-08-01). Until the anon
   key is baked beside it, supply the key once per browser (dev console):

   ```js
   localStorage.setItem('escape-work.remote', JSON.stringify({ anonKey: '<anon/public key>' }));
   ```

   The key lives in the dashboard under Settings → API ("anon public"). It is
   designed to ship in clients — row-level security is the fence — so once
   it's committed into `SHIPPED_REMOTE.anonKey`, nobody configures anything.

## Later, when wanted

- Bake the config into the itch build (a build.mjs define) so players get
  cloud saves without console incantations `[proposed]`.
- Level sharing's agreed shape (designer, 2026-08-01: minimum now, this
  when the feature lands): anonymous auth + invisible captcha to mint
  identities, per-identity creation quotas, and an approval flag only the
  designer can set — public lists show approved levels only.
- The same RPC pattern fits shared editor levels and leaderboards — new
  tables, same client shape.
- Free-tier projects pause after ~a week idle; the game warns once per
  session ("the Supabase project is paused") and plays on local saves until
  the dashboard un-pauses it.
