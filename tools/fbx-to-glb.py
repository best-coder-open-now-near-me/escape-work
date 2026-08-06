# Convert a Unity asset package's .fbx files into the .glb files this game
# loads (see src/models.js). Run under Blender, not plain Python:
#
#   blender -b --factory-startup -noaudio --python tools/fbx-to-glb.py -- \
#       --src <unity-package-dir> --out assets/office
#
# A licensed pack kept outside version control can instead use the checked-in
# selection manifest (paths are relative to the current working directory):
#
#   blender -b --factory-startup -noaudio --python tools/fbx-to-glb.py -- \
#       --manifest tools/synty-assets.json --wave office-core \
#       --report tools/reports/synty-office-core.json
#
# PlayCanvas has no runtime FBX loader - the `container` asset type is
# glTF/GLB only, and FBX->glTF conversion normally happens in the PlayCanvas
# Editor, which this project doesn't use ("No PlayCanvas cloud involved" -
# build.mjs). So conversion is an authoring step: run this once, commit the
# .glb, and every prop is a plain `model:` tile like the Kenney kit.
#
# WHY THE .meta FILES MATTER: a Unity package's .fbx files are only half the
# asset. Scale and materials live beside them in Unity's YAML sidecars, and
# reading those is the difference between a faithful convert and a guess:
#
#   <model>.fbx.meta   ModelImporter.meshes.globalScale - the Scale Factor
#                      Unity applies on import. The raw FBX is in Maya units;
#                      without this every prop comes out 4x too small.
#   <name>.mat         The material. Older packs name it directly in the FBX;
#                      newer Synty packs assign it by GUID in the matching
#                      prefab. The .mat then names its albedo texture by GUID.
#   <name>.prefab      MeshRenderer material GUIDs for FBX slots with generic
#                      names such as Shop_MAT. Ignoring this exports white.
#
# Blender's FBX importer only sees the .fbx, so this script reads the sidecars
# itself and rebuilds each material before exporting.
import sys
import os
import re
import json
import argparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    import bpy
except ModuleNotFoundError:  # Pure manifest/material tests run without Blender.
    bpy = None

from unity_materials import (
    prefab_for_model,
    prefab_material_guids,
    read_material_libraries,
)

# Mirrors SIGHT_BLOCK_HEIGHT in src/data/tiles.js. Duplicated rather than
# imported because this script runs inside Blender's Python, which has no view
# of the game's modules - and a wrong number here is a misleading report rather
# than a broken build. tests/unit/levels.test.js pins the JS side.
SIGHT_BLOCK_HEIGHT = 0.75


# --- Unity YAML sidecars ------------------------------------------------------
# Unity's .meta/.mat files are YAML, but pulling in a YAML parser to read three
# scalars is not worth it - and .mat files use Unity's `!u!21 &2100000` tag
# syntax, which trips most stock parsers anyway. These regexes are deliberately
# narrow: they match the one field each, or return None so the caller falls
# back to a documented default.

def read_global_scale(fbx_path):
    """ModelImporter.meshes.globalScale from <model>.fbx.meta (default 1.0).

    This is Unity's "Scale Factor" import setting. The pack authors it per
    model - 4.0 for props, 3.75 for characters - and it is what makes the
    models land at real-world metres.
    """
    meta = fbx_path + '.meta'
    if not os.path.exists(meta):
        return 1.0
    text = open(meta, encoding='utf8', errors='replace').read()
    m = re.search(r'^\s*globalScale:\s*([\d.eE+-]+)', text, re.M)
    return float(m.group(1)) if m else 1.0


def find_atlas(pack_dir):
    """The pack's shared texture atlas. Props/ and Characters/ ship byte-identical
    copies of texture_01.png, so the first one found serves both."""
    for root, _dirs, files in os.walk(pack_dir):
        for fn in files:
            if fn.lower().endswith('.png') and 'texture' in fn.lower():
                return os.path.join(root, fn)
    return None


# --- material construction ----------------------------------------------------

def build_material(name, spec, atlas_path, cache):
    """A Principled BSDF carrying the Unity material's colour and, when it uses
    one, the atlas texture. The game re-shades everything at runtime
    (toonifyMaterial in src/shading.js swaps the diffuse term), so this only
    has to get base colour right - roughness/metallic are set flat so the toon
    bands have a clean surface to work on."""
    if name in cache:
        return cache[name]
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    r, g, b, a = spec['color']
    bsdf.inputs['Base Color'].default_value = (r, g, b, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    texture_path = spec.get('texture') or (atlas_path if spec.get('uses_texture') else None)
    if texture_path:
        image_name = os.path.basename(texture_path)
        img = bpy.data.images.get(image_name) or bpy.data.images.load(texture_path)
        img.name = image_name
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = img
        # The atlas is a palette: flat colour patches packed edge to edge, so
        # linear filtering samples across patch borders and fringes every UV
        # island. Closest keeps each face its one authored colour.
        tex.interpolation = 'Closest'
        mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
    cache[name] = mat
    return mat


def clean_stem(stem):
    """Pack filename -> asset filename.

    The tile registry stores a `model` path that becomes a URL
    (`assets/${def.model}.glb` in tile-renderer.js), and this pack ships at
    least one file with a space in it ("mesh_clock 1.fbx") that would need
    escaping at every use site. Drop the redundant mesh_ prefix and reduce
    anything URL-unsafe to a dash, so the registry entry is the filename.
    """
    stem = re.sub(r'^[Mm]esh_', '', stem)
    return re.sub(r'[^A-Za-z0-9_-]+', '-', stem).strip('-')


def manifest_jobs(path, selected_wave=None, src_override=None, out_override=None):
    """Resolve a checked-in selection manifest into concrete conversion jobs.

    Source and output roots intentionally remain overridable: licensed assets
    may live outside the repository in CI or on another developer's machine.
    """
    with open(path, encoding='utf8') as stream:
        manifest = json.load(stream)
    src_root = os.path.abspath(src_override or manifest['sourceRoot'])
    out_root = os.path.abspath(out_override or manifest['outputRoot'])
    jobs = []
    wave_ids = {wave['id'] for wave in manifest.get('waves', [])}
    if selected_wave and selected_wave not in wave_ids:
        raise ValueError(
            f'Unknown wave {selected_wave!r}; choose one of: {", ".join(sorted(wave_ids))}'
        )
    for wave in manifest.get('waves', []):
        if selected_wave and wave['id'] != selected_wave:
            continue
        for asset in wave.get('assets', []):
            jobs.append({
                'id': asset['id'],
                'wave': wave['id'],
                'src': os.path.join(src_root, *asset['source'].split('/')),
                'out': os.path.join(out_root, *asset['output'].split('/')),
                'ground': asset.get('ground', True),
            })
    return src_root, out_root, jobs


# --- conversion ---------------------------------------------------------------

def convert(fbx_path, out_path, mats, atlas_path, cache, ground=True,
            assigned_materials=None):
    if bpy is None:
        raise RuntimeError('FBX conversion must run under Blender')
    import mathutils
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scale = read_global_scale(fbx_path)
    # global_scale reproduces Unity's Scale Factor exactly: Blender already
    # applies the FBX's own unit scale (matching Unity's useFileUnits: 1), so
    # multiplying by globalScale on top lands at the same size Unity shows.
    bpy.ops.import_scene.fbx(filepath=fbx_path, global_scale=scale,
                             automatic_bone_orientation=True)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        return None

    # Re-materialise from the .mat library. The FBX only carries the material
    # NAME, and Blender's importer turns an unresolvable material into default
    # grey, so every slot is rebuilt here from the Unity definition. Names that
    # aren't in the library keep whatever the FBX gave them.
    assigned_materials = assigned_materials or []
    one_assigned = assigned_materials[0] if len(assigned_materials) == 1 else None
    unresolved = set()
    assigned_index = 0
    for obj in meshes:
        for slot in obj.material_slots:
            if not slot.material:
                continue
            name = slot.material.name.split('.')[0]
            spec = one_assigned
            if spec is None and assigned_index < len(assigned_materials):
                spec = assigned_materials[assigned_index]
            if spec is None:
                spec = mats.get(name.lower())
            if spec:
                slot.material = build_material(spec.get('name', name), spec, atlas_path, cache)
            else:
                unresolved.add(name)
            assigned_index += 1

    # Drop the model onto its own origin. Props in this pack are authored at
    # the height they sit at in the demo scene - desk clutter (laptop, mug,
    # phone) around y=0.97, wall fittings (clock, alarm) higher still, and a
    # few below zero. The game places a prop with the holder's origin AT the
    # floor surface (tile-renderer.js passes `lift: floorDef.height / 2`), so
    # anything not based at zero floats or sinks by exactly that offset.
    # Re-basing here keeps that arithmetic in one place instead of forcing a
    # per-prop fudge in the tile registry.
    if ground:
        low = min((obj.matrix_world @ mathutils.Vector(c)).z
                  for obj in meshes for c in obj.bound_box)
        for obj in meshes:
            obj.location.z -= low

    # Bake the import scale into the vertices. placeModel applies its own
    # `scale` from the tile registry on top, so the .glb needs to arrive with
    # no leftover object-level transform for that to compose predictably.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Blender uniquifies a new datablock whose name is taken, so rebuilding
    # `items` while the FBX's own `items` is still loaded yields `items.001` -
    # and that suffix would ship in the .glb. Drop the now-unused originals and
    # take the plain name back.
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for mat in bpy.data.materials:
        base = re.sub(r'\.\d{3}$', '', mat.name)
        if base != mat.name and base not in bpy.data.materials:
            mat.name = base

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,            # glTF is Y-up; Blender is Z-up
        export_apply=True,          # evaluate modifiers
        export_materials='EXPORT',
        export_image_format='AUTO',
        use_selection=False,
    )

    # Report the exported size so tiles.js `scale`/`height` can be set from
    # measurements rather than eyeballed.
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    tris = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
    # Blender is Z-up; the exported glTF is Y-up, so Blender Z is the model's
    # height and Blender Y is its depth.
    return {
        'width': round(mx[0] - mn[0], 4),
        'depth': round(mx[1] - mn[1], 4),
        'height': round(mx[2] - mn[2], 4),
        'floor': round(mn[2], 4),
        'tris': tris,
        'scale_factor': scale,
        'unresolved_materials': sorted(unresolved),
    }


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=None,
                    help='Unity package directory to walk (or override manifest sourceRoot)')
    ap.add_argument('--out', default=None,
                    help='output directory for .glb files (or override manifest outputRoot)')
    ap.add_argument('--manifest', default=None,
                    help='selection manifest; converts only its named assets')
    ap.add_argument('--wave', default=None,
                    help='manifest wave id to convert (default: every wave)')
    ap.add_argument('--only', default=None, help='substring filter on the .fbx path')
    ap.add_argument('--report', default=None, help='write a JSON size report here')
    ap.add_argument('--no-ground', action='store_true',
                    help='keep the authored origin instead of basing the model at y=0')
    args = ap.parse_args(argv)

    if args.manifest:
        src_root, out_root, jobs = manifest_jobs(
            args.manifest, args.wave, args.src, args.out
        )
    else:
        if not args.src or not args.out:
            ap.error('--src and --out are required without --manifest')
        src_root = os.path.abspath(args.src)
        out_root = os.path.abspath(args.out)
        jobs = None

    mats, mats_by_guid = read_material_libraries(src_root)
    atlas = find_atlas(src_root)
    print(f'[fbx-to-glb] {len(mats)} materials, atlas={atlas}')

    cache = {}
    report = {}
    print(f'[fbx-to-glb] sight-block threshold is {SIGHT_BLOCK_HEIGHT} '
          f'(src/data/tiles.js) - a prop at or above it stops thrown attacks')
    if jobs is None:
        jobs = []
        for root, _dirs, files in os.walk(src_root):
            for fn in sorted(files):
                if not fn.lower().endswith('.fbx'):
                    continue
                src = os.path.join(root, fn)
                if args.only and args.only not in src:
                    continue
                stem = clean_stem(os.path.splitext(fn)[0])
                jobs.append({
                    'id': stem,
                    'wave': None,
                    'src': src,
                    'out': os.path.join(out_root, stem + '.glb'),
                    'ground': not args.no_ground,
                })

    for job in jobs:
        src = job['src']
        out = job['out']
        stem = job['id']
        if not os.path.isfile(src):
            raise FileNotFoundError(f'Manifest source does not exist: {src}')
        cache.clear()  # materials are per-file; the .blend is reset each time
        prefab = prefab_for_model(src_root, src)
        material_guids = prefab_material_guids(prefab) if prefab else []
        assigned_materials = []
        missing_material_guids = []
        for material_guid in material_guids:
            spec = mats_by_guid.get(material_guid)
            if spec:
                assigned_materials.append(spec)
            else:
                missing_material_guids.append(material_guid)
        info = convert(
            src, out, mats, atlas, cache,
            ground=job['ground'] and not args.no_ground,
            assigned_materials=assigned_materials,
        )
        if info is None:
            print(f'[fbx-to-glb] SKIP (no mesh) {os.path.basename(src)}')
            continue
        # The `height` a tile type declares is not decoration: at or above
        # SIGHT_BLOCK_HEIGHT the prop stops thrown attacks and blocks the
        # line a fight is decided on (data/tiles.js blocksSight). That
        # threshold was invisible at conversion time, so whether a new
        # bookcase was cover or a wall was discovered in play. The script
        # already measures the model; say what the measurement implies.
        info['blocks_sight'] = info['height'] >= SIGHT_BLOCK_HEIGHT
        info['prefab'] = os.path.relpath(prefab, src_root) if prefab else None
        info['missing_material_guids'] = missing_material_guids
        report[stem] = info
        sight = 'BLOCKS SIGHT' if info['blocks_sight'] else 'shoot over'
        print(f'[fbx-to-glb] OK {stem:40s} '
              f'W={info["width"]:.3f} D={info["depth"]:.3f} H={info["height"]:.3f} '
              f'tris={info["tris"]:6d}  -> {sight}')
        if info['unresolved_materials'] or missing_material_guids:
            print(f'[fbx-to-glb] WARN {stem}: unresolved slots='
                  f'{info["unresolved_materials"]}, GUIDs={missing_material_guids}')

    if args.report:
        report_dir = os.path.dirname(os.path.abspath(args.report))
        os.makedirs(report_dir, exist_ok=True)
        with open(args.report, 'w') as fh:
            json.dump(report, fh, indent=2, sort_keys=True)
        print(f'[fbx-to-glb] report -> {args.report}')


if __name__ == '__main__':
    main()
