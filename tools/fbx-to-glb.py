# Convert a Unity asset package's .fbx files into the .glb files this game
# loads (see src/models.js). Run under Blender, not plain Python:
#
#   blender -b --factory-startup -noaudio --python tools/fbx-to-glb.py -- \
#       --src <unity-package-dir> --out assets/office
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
#   <name>.mat         The material. Most of this pack's materials are flat
#                      colours with no texture at all (_MainTex empty) - only
#                      `items` and `character` sample the shared atlas. The
#                      FBX stores just the material NAME, so without the .mat
#                      library every prop converts to default grey.
#
# Blender's FBX importer only sees the .fbx, so this script reads the sidecars
# itself and rebuilds each material before exporting.
import bpy
import sys
import os
import re
import json
import argparse

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


def read_materials(pack_dir):
    """Build {material name -> {'color': (r,g,b,a), 'atlas': bool}} from .mat files.

    Unity serialises _Color in LINEAR space, which is exactly what glTF's
    baseColorFactor wants, so the values pass straight through with no
    sRGB conversion. `atlas` is true when _MainTex actually points at a
    texture (m_Texture fileID 2800000); an empty _MainTex is fileID 0.
    """
    mats = {}
    for root, _dirs, files in os.walk(pack_dir):
        for fn in files:
            if not fn.endswith('.mat'):
                continue
            path = os.path.join(root, fn)
            text = open(path, encoding='utf8', errors='replace').read()
            color = (1.0, 1.0, 1.0, 1.0)
            m = re.search(
                r'-\s+_Color:\s*\{r:\s*([\d.eE+-]+),\s*g:\s*([\d.eE+-]+),'
                r'\s*b:\s*([\d.eE+-]+),\s*a:\s*([\d.eE+-]+)\}', text)
            if m:
                color = tuple(float(v) for v in m.groups())
            atlas = bool(re.search(r'_MainTex:\s*\n\s*m_Texture:\s*\{fileID:\s*2800000', text))
            # Keyed lower-case: the FBX material names and the .mat filenames
            # disagree on case (meshes ask for `wood`, the library ships
            # `Wood.mat`), and an exact match silently drops those slots back
            # to the FBX's own default colour.
            mats[os.path.splitext(fn)[0].lower()] = {'color': color, 'atlas': atlas}
    return mats


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
    if spec['atlas'] and atlas_path:
        img = bpy.data.images.get('atlas') or bpy.data.images.load(atlas_path)
        img.name = 'atlas'
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


# --- conversion ---------------------------------------------------------------

def convert(fbx_path, out_path, mats, atlas_path, cache, ground=True):
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
    for obj in meshes:
        for slot in obj.material_slots:
            if not slot.material:
                continue
            name = slot.material.name.split('.')[0]
            spec = mats.get(name.lower())
            if spec:
                slot.material = build_material(name, spec, atlas_path, cache)

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
    }


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='Unity package directory to walk')
    ap.add_argument('--out', required=True, help='output directory for .glb files')
    ap.add_argument('--only', default=None, help='substring filter on the .fbx path')
    ap.add_argument('--report', default=None, help='write a JSON size report here')
    ap.add_argument('--no-ground', action='store_true',
                    help='keep the authored origin instead of basing the model at y=0')
    args = ap.parse_args(argv)

    mats = read_materials(args.src)
    atlas = find_atlas(args.src)
    print(f'[fbx-to-glb] {len(mats)} materials, atlas={atlas}')

    cache = {}
    report = {}
    for root, _dirs, files in os.walk(args.src):
        for fn in sorted(files):
            if not fn.lower().endswith('.fbx'):
                continue
            src = os.path.join(root, fn)
            if args.only and args.only not in src:
                continue
            stem = clean_stem(os.path.splitext(fn)[0])
            out = os.path.join(args.out, stem + '.glb')
            cache.clear()  # materials are per-file; the .blend is reset each time
            info = convert(src, out, mats, atlas, cache, ground=not args.no_ground)
            if info is None:
                print(f'[fbx-to-glb] SKIP (no mesh) {fn}')
                continue
            report[stem] = info
            print(f'[fbx-to-glb] OK {stem:40s} '
                  f'W={info["width"]:.3f} D={info["depth"]:.3f} H={info["height"]:.3f} '
                  f'tris={info["tris"]}')

    if args.report:
        with open(args.report, 'w') as fh:
            json.dump(report, fh, indent=2, sort_keys=True)
        print(f'[fbx-to-glb] report -> {args.report}')


main()
