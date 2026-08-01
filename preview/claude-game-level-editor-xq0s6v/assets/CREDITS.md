# Asset credits

Most third-party assets here are CC0 (public domain), free for commercial use.
The exception is `office/` - see **Office props** below, which is a PAID Unity
Asset Store pack under a different licence. Check that section before assuming
anything under `assets/` can be freely redistributed.

The repo's own code is MIT (see `LICENSE` at the root). That covers the code
only - everything under `assets/` is third-party, credited below, and carries
its own terms rather than the MIT grant.

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

- **Foliage Sprites (1.0)** by **Kenney** — https://www.kenney.nl. License: CC0.
  Five of the fifty sprites live in `foliage/` as the leaf silhouettes the
  big office plants are built from (`ficus`, `palm` in `src/data/tiles.js`):
  `bush`/`bush2` (sprite_0091/0090), `rosette` (0084), `leaf` (0089),
  `tuft` (0063). Each was cropped to its alpha bounds and downscaled from
  1024px to 256px - the source is mostly empty margin, and these render a
  foot tall. Only the ALPHA is used: the sprites are white silhouettes, and
  `shading.makeSpriteMaterial` fills the shape with a flat palette colour,
  so nothing photographic enters the toon look. These are the only textured
  assets in the game.

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

## Office props
- **Low Poly Office Pack: Characters & Props (1.0)** by **Polygonal Mind** —
  https://polygonalmind.com. Unity Asset Store product `119386`.

  **Licence: not CC0** - a free Unity Asset Store download, so it comes under
  the Asset Store EULA rather than the public-domain grant the rest of this
  file describes. Free-to-download is not the same as public-domain: the EULA
  covers shipping these models inside the game, which is what this repo does.
  Worth knowing before anyone treats `office/` like the CC0 kits above and
  reuses it elsewhere. `tools/` regenerates every file from the original
  `.unitypackage` if the binaries ever need to come out of git.

  The 62 props live in `office/`, converted from the pack's `.fbx` by
  `tools/fbx-to-glb.py` (see `tools/README.md`). Filenames are the pack's own,
  minus the redundant `mesh_` prefix. Unlike the kits above these are in real
  metres, so `src/data/tiles.js` scales the whole pack by a single 0.5.
  Five are registered as paintable tile types; the other 57 are in the repo
  ready to register, the only limit being a free legend character each.

  The pack's 29 characters and 5 Mixamo clips are NOT converted - the game's
  character pipeline (`src/models.js`) expects the Kenney mini rig's 7-bone
  skeleton and `idle`/`walk`/`attack-melee-right` clips, and this pack ships a
  23-bone humanoid whose only clips are sitting and typing.
