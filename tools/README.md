# tools/

Authoring-time scripts. Nothing here runs at build time or ships in the game -
`build.mjs` never touches this directory. These exist to turn source art into
the `.glb` files `assets/` holds, and you run them by hand when new art
arrives.

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

For licensed packs that must stay outside this public repository, use a
checked-in source-relative selection manifest. `tools/synty-assets.json`
defines the first office waves while `assets/Synty/` and
`assets/licensed/` remain ignored:

```sh
blender -b --factory-startup -noaudio --python tools/fbx-to-glb.py -- \
    --manifest tools/synty-assets.json \
    --wave office-core \
    --report tools/reports/synty-office-core.json
```

`--src` and `--out` override a manifest's roots for a licensed private CI
workspace. The newer Synty packs use `_Albedo_Map` GUID references instead of
the older pack's single `_MainTex` atlas; `unity_materials.py` resolves both.

## Synty characters

Synty character packs use monolithic FBXs: one shared Humanoid armature plus
many alternative skinned bodies. `tools/synty-characters.json` selects bodies
by mesh name and records the separate animation contract. Export a static,
correctly textured validation body with:

```sh
blender -b --factory-startup -noaudio --python tools/synty-character-to-glb.py -- \
    --character shops-worker-male \
    --animation-root /licensed/RPG-Character/Animations \
    --report tools/reports/synty-characters.json
```

The model exporter deliberately strips the pose reel embedded in the Synty
source FBX. The selected RPG Character Mecanim clips are real Unity Humanoid
animations, but they target another skeleton. Unity 6 has been used to verify
that idle, forward-run, and unarmed-attack clips all retarget onto the Synty
Humanoid avatar.

`tools/unity/EscapeWorkHumanoidBake.cs` is the licensed-workspace bridge. Put
or link it beneath `Assets/Editor` in a Unity project that has the two packs,
then run Unity in batch mode:

```powershell
Unity.exe -batchmode -nographics `
  -projectPath C:\private\escape-work-character-bake `
  -executeMethod EscapeWorkHumanoidBake.Run `
  -escapeWorkManifest E:\GodotGames\escape-work\tools\synty-characters.json `
  -escapeWorkBakeRig synty-shops `
  -escapeWorkSyntyAssetRoot Assets/Synty `
  -escapeWorkAnimationAssetRoot "Assets/ExplosiveLLC/RPG Character Mecanim Animation Pack FREE/Animations" `
  -logFile C:\private\escape-work-character-bake.log
```

The command samples every manifest clip at 30 fps after Unity retargets it,
and writes target-rig rest and pose data beneath the ignored licensed output
root. Source animation events are retained as authoring metadata; PlayCanvas
gameplay events remain owned by the game's combat/timing data. A slowed run is
currently the temporary `walk` because the free animation pack has no true
walk cycle. Run it once per manifest `bakes` entry; each unique rig/rest-pose
family gets its own bake while every body on that rig shares the result.

Run `synty-character-to-glb.py` again after the bake. It discovers the bake at
the manifest's ignored output path (or accepts `--bake <path>`), maps Unity's
world poses through the target rig's Blender rest pose, and exports one named
glTF action per manifest clip. This rest-pose mapping is what makes the bridge
robust to Blender's FBX bone-roll conversion instead of relying on source and
target bone axes accidentally matching.

### Why it reads the Unity metadata

A Unity package's `.fbx` files are only half the asset - scale and materials
live beside them in Unity's YAML sidecars. Ignore those and the conversion is
a guess:

| Sidecar | What it carries | Cost of ignoring it |
| --- | --- | --- |
| `<model>.fbx.meta` | `ModelImporter.meshes.globalScale`, Unity's Scale Factor | The raw FBX is in Maya units. This pack authors 4.0 for most props, but 5.0 for walls and 1.0–6.0 for others, so one hardcoded number cannot be right for the whole pack. With it, walls land at exactly 3.000 m. |
| `<name>.mat` | The material: `_Color`, and whether `_MainTex` is bound | The FBX stores only a material *name*. Most of this pack's materials are flat colours with no texture at all - only `items` and `character` sample the shared atlas. Without the `.mat` library every prop converts to default grey. |
| matching `.prefab` | MeshRenderer material GUID assignments | Newer Synty FBX files carry generic slot names such as `Shop_MAT`; Unity applies the real atlas material in the prefab. Without that indirection every converted prop is white. |

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
- **Follows prefab material GUIDs.** For packs whose FBX names no useful
  material, the matching prefab selects the `.mat`, whose albedo GUID then
  resolves to the texture beside its `.meta`. Unresolved slots and GUIDs are
  printed and included in the report instead of silently exporting white.
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
