# Asset credits

All third-party assets here are CC0 (public domain), free for commercial use.

The repo's own code is MIT (see `LICENSE` at the root). That covers the code
only - everything under `assets/` is third-party CC0, credited below, and
carries its own terms rather than the MIT grant.

## Furniture (environment)
- **KayKit : Furniture Bits (1.0)** by **Kay Lousberg** — https://www.kaylousberg.com
  (https://kaylousberg.itch.io). License: CC0. Source `.gltf` files were converted
  to self-contained `.glb` for this project. Files: `furniture/desk.glb` (table),
  `furniture/chair.glb`, `furniture/cabinet.glb`, `furniture/plant.glb` (cactus),
  `furniture/couch.glb` (couch_pillows), `furniture/bookshelf.glb`
  (shelf_B_large_decorated), `furniture/lamp.glb` (lamp_standing).

- **Furniture Kit (1.0)** by **Kenney** — https://www.kenney.nl. License: CC0.
  The full 140-model kit lives in `furniture/kit/` (its own folder because the
  kit ships its own `desk.glb`/`chair.glb`, which would otherwise collide with
  the KayKit pieces above). Shipped as GLB, used as-is. Around sixty are
  registered as paintable tile types in `src/data/tiles.js`; the rest are in
  the repo ready to register, the only limit being that a level's map is one
  character per cell so each type needs a free char.

## Characters
- **Mini Characters (1.0)** by **Kenney** — https://www.kenney.nl. License: CC0.
  Shipped as GLB, used as-is (+ shared `characters/Textures/`). All twelve
  characters from the pack are in use, renamed to the role each one plays:

  | file | pack original |
  | --- | --- |
  | `characters/worker.glb` | `character-male-a` |
  | `characters/itsupport.glb` | `character-male-b` |
  | `characters/security.glb` | `character-male-c` |
  | `characters/veteran.glb` | `character-male-d` |
  | `characters/hr.glb` | `character-male-e` |
  | `characters/regional.glb` | `character-male-f` |
  | `characters/intern.glb` | `character-female-a` |
  | `characters/executive.glb` | `character-female-b` |
  | `characters/manager.glb` | `character-female-c` |
  | `characters/midmanager.glb` | `character-female-d` |
  | `characters/hrrep.glb` | `character-female-e` |
  | `characters/seniormanager.glb` | `character-female-f` |
