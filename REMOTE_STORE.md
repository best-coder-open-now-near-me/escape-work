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

1. Create a project at supabase.com (free tier), then in the SQL editor run:

   ```sql
   create table public.saves (
     device_id  text primary key,
     data       jsonb not null,
     updated_at timestamptz not null default now()
   );
   alter table public.saves enable row level security;
   -- Playtest-grade policy: the anon key may read/write save rows. Anyone
   -- with the shipped key could touch any row - acceptable for game saves,
   -- not for anything sensitive. The upgrade path is Supabase anonymous
   -- auth (per-browser JWTs) with a policy of `device_id = auth.uid()`.
   create policy "playtest saves" on public.saves
     for all to anon using (true) with check (true);
   ```

2. In the browser you play in (dev console, once):

   ```js
   localStorage.setItem('escape-work.remote', JSON.stringify({
     url: 'https://<project-ref>.supabase.co',
     anonKey: '<the project’s anon/public key>',
   }));
   ```

   Project URL and anon key live in the dashboard under Settings → API. The
   anon key is designed to ship in clients; row-level security is the fence.

## Later, when wanted

- Bake the config into the itch build (a build.mjs define) so players get
  cloud saves without console incantations `[proposed]`.
- Anonymous auth + per-user policies, if saves ever matter enough to fence.
- The same table pattern fits shared editor levels and leaderboards — new
  tables, same client shape.
- Free-tier projects pause after ~a week idle; the game warns once per
  session ("the Supabase project is paused") and plays on local saves until
  the dashboard un-pauses it.
