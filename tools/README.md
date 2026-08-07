# tools/

Authoring-time scripts. Nothing here runs at build time or ships in the game -
`build.mjs` never touches this directory. These exist to turn source art into
the `.glb` files `assets/` holds, and you run them by hand when new art
arrives.

## Optional licensed art profile

Licensed source and converted files stay under ignored `assets/licensed/`.
The opt-in Synty profile copies only the six runtime GLBs allowlisted in
`src/data/art-profiles.js`; normal builds copy none of them.

```sh
npm run build:synty
npm run serve:synty
```

The default source is `assets/licensed/synty`. Set
`ESCAPE_WORK_SYNTY_SOURCE` to a different private checkout before running the
profile if the converted tree lives elsewhere. Gameplay keeps its existing
class and tile ids: the profile changes presentation only, so removing it or
replacing the art does not migrate saves or levels.

### Split a private runtime package for transfer

`bundle-private-assets.mjs` packages any prepared private-asset tree as a set
of deterministic ZIP volumes. The default ceiling is an exclusive 24,000,000
bytes, leaving a full decimal megabyte of margin below a 25 MB upload limit.
It uses only Node built-ins, preserves relative paths, and writes a JSON index
containing the size, SHA-256 hash, and owning volume for every source file.

```sh
npm run bundle:private-assets -- \
  --source build/private-assets-synty \
  --out build/private-assets-synty-split \
  --name escape-work-synty-runtime
```

Extract every volume into the same private-repository root. Files never span
volumes, so ordinary ZIP tools are sufficient. If one individual file cannot
fit below the ceiling, the command stops and names it instead of producing an
invalid partial bundle. Use `--force` to replace an existing output directory,
or `--max-mb` / `--max-bytes` to choose a different exclusive ceiling.

## fbx-to-glb.py — Unity `.fbx` → game `.glb`

### Why this exists

PlayCanvas has **no runtime FBX loader**. The `container` asset type that
`src/models.js` loads is glTF/GLB only. FBX support in the PlayCanvas world
lives in the *Editor*, which converts FBX to glTF server-side on upload - and
this project deliberately doesn't use it ("No PlayCanvas cloud involved:
everything that makes the game is in this repo" — `build.mjs`).

So FBX support is an authoring step, not a runtime feature: convert once,
commit the `.glb`, and the model is a plain `model:` tile like any other.

### Running it

Needs Blender (tested on 4.0) with numpy available to its Python:

```sh
sudo apt-get install -y blender python3-numpy

blender -b --factory-startup -noaudio --python tools/fbx-to-glb.py -- \
    --src /path/to/PolygonalMind/LowPolyOffice/Props \
    --out assets/office \
    --report /tmp/props.json
```

Flags: `--only <substring>` converts a single model; `--no-ground` keeps the
authored origin instead of re-basing the model at y=0.

### Why it reads the Unity metadata

A Unity package's `.fbx` files are only half the asset - scale and materials
live beside them in Unity's YAML sidecars. Ignore those and the conversion is
a guess:

| Sidecar | What it carries | Cost of ignoring it |
| --- | --- | --- |
| `<model>.fbx.meta` | `ModelImporter.meshes.globalScale`, Unity's Scale Factor | The raw FBX is in Maya units. This pack authors 4.0 for most props, but 5.0 for walls and 1.0–6.0 for others, so one hardcoded number cannot be right for the whole pack. With it, walls land at exactly 3.000 m. |
| `<name>.mat` | The material: `_Color`, and whether `_MainTex` is bound | The FBX stores only a material *name*. Most of this pack's materials are flat colours with no texture at all - only `items` and `character` sample the shared atlas. Without the `.mat` library every prop converts to default grey. |

Unity serialises `_Color` in linear space, which is what glTF's
`baseColorFactor` wants, so those values pass straight through.

### What it does beyond a plain convert

- **Grounds each model at y=0.** Props are authored at the height they sit at
  in the pack's demo scene - desk clutter around y=0.97, wall fittings higher.
  The game puts a prop's origin *at* the floor (`tile-renderer.js` passes
  `lift: floorDef.height / 2`), so an un-grounded prop floats by exactly that
  offset.
- **Matches material names case-insensitively.** Meshes ask for `wood`; the
  library ships `Wood.mat`. An exact match silently drops 11 of this pack's
  material slots back to the FBX default.
- **Reclaims material names.** Blender uniquifies a datablock whose name is
  taken, so rebuilding `items` while the FBX's own `items` is loaded yields
  `items.001` - and that suffix would ship in the `.glb`.
- **Samples the atlas with nearest-neighbour.** The texture is a palette of
  flat colour patches packed edge to edge; linear filtering samples across
  patch borders and fringes every UV island.
- **Sanitises filenames.** The registry's `model` becomes a URL, and this pack
  ships `mesh_clock 1.fbx`, whose space would need escaping at every use site.

### Sizing a converted prop

`--report` writes each model's real-world dimensions. Because the import scale
is baked in, this pack's output is in **metres** - so a tile entry's numbers
are a measurement, not a guess: `scale: 0.5` for the whole pack, and
`height` = the reported height / 2. That factor is calibrated, not arbitrary -
the pack's desk is 1.87 m × 0.99 m, which at 0.5 lands at 0.94 × 0.50 and
matches the existing `desk` tile to the centimetre.

### What it does not do

Characters. It converts their meshes fine, but the game's character pipeline
(`setupAnim` and `applyCharacterProportions` in `src/models.js`) is written
against the Kenney mini rig: a 7-bone skeleton with `root`/`torso`/`head`/
`leg-left` bone names and baked `idle`/`walk`/`attack-melee-right` clips. The
Polygonal Mind characters are 23-bone humanoids whose only clips are sitting
and typing. Converting them is a retarget job, not an import job.
