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
- **Failure is silent by design.** Dead network, paused free-tier project,
  bad key — pushes report false, pulls report null, the game never notices.

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
- Free-tier projects pause after ~a week idle; the game shrugs (silent
  failure posture), un-pausing in the dashboard revives sync.
