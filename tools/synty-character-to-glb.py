"""Export one skinned Synty mesh from a monolithic Unity FBX as a GLB.

This is the model half of the character pipeline. Synty character FBXs contain
one shared humanoid armature and many alternative skinned bodies. Unity prefabs
select a body and assign its atlas material; Blender sees every body and a
generic material name. The manifest makes that selection explicit.

Source animation is intentionally stripped. The selected Explosive LLC clips
are Unity Humanoid animations on another hierarchy. EscapeWorkHumanoidBake.cs
samples Unity's retargeted target-rig pose; this script maps that bake back to
the Blender armature and includes named actions in the GLB.
"""

import argparse
import importlib.util
import json
import os
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    import bpy
except ModuleNotFoundError:
    bpy = None

from unity_materials import prefab_material_guids, read_material_libraries


PROP_CONVERTER_SPEC = importlib.util.spec_from_file_location(
    'synty_prop_converter', os.path.join(SCRIPT_DIR, 'fbx-to-glb.py')
)
PROP_CONVERTER = importlib.util.module_from_spec(PROP_CONVERTER_SPEC)
PROP_CONVERTER_SPEC.loader.exec_module(PROP_CONVERTER)


def _root(manifest_path, value, override):
    if override:
        return os.path.abspath(override)
    if os.path.isabs(value):
        return os.path.normpath(value)
    return os.path.abspath(os.path.join(os.path.dirname(manifest_path), '..', value))


def manifest_jobs(manifest_path, selected=None, synty_root=None,
                  animation_root=None, output_root=None):
    manifest_path = os.path.abspath(manifest_path)
    with open(manifest_path, encoding='utf8') as stream:
        manifest = json.load(stream)
    source_root = _root(manifest_path, manifest['syntyRoot'], synty_root)
    anim_root = _root(manifest_path, manifest['animationRoot'], animation_root)
    out_root = _root(manifest_path, manifest['outputRoot'], output_root)
    known = {character['id'] for character in manifest.get('characters', [])}
    if selected and selected not in known:
        raise ValueError(
            f'Unknown character {selected!r}; choose one of: {", ".join(sorted(known))}'
        )
    jobs = []
    for character in manifest.get('characters', []):
        if selected and character['id'] != selected:
            continue
        jobs.append({
            'id': character['id'],
            'rig': character['rig'],
            'mesh': character['mesh'],
            'src': os.path.join(source_root, *character['source'].split('/')),
            'prefab': os.path.join(source_root, *character['prefab'].split('/')),
            'out': os.path.join(out_root, *character['output'].split('/')),
        })
    clips = [{
        **clip,
        'path': os.path.join(anim_root, *clip['source'].split('/')),
    } for clip in manifest.get('clips', [])]
    return source_root, anim_root, out_root, jobs, clips, manifest['rigContract']


def _dimensions(obj):
    # Character meshes live under the imported rig's axis-conversion transform.
    # `obj.dimensions` ignores that parent transform and reports the 1.79m body
    # along local Y, making a correct upright export look 0.295m tall. Measure
    # the same world-space corners the glTF exporter sees.
    from mathutils import Vector
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = [min(point[axis] for point in corners) for axis in range(3)]
    high = [max(point[axis] for point in corners) for axis in range(3)]
    dims = [high[axis] - low[axis] for axis in range(3)]
    return {
        'width': round(dims[0], 6),
        'depth': round(dims[1], 6),
        'height': round(dims[2], 6),
    }


def _unity_pose_matrix(pose):
    """Convert a Unity root-relative pose to Blender's world basis.

    Unity is left-handed Y-up; Blender is right-handed Z-up. The FBX import
    maps Unity (X, Y, Z) to Blender (-X, -Z, Y). Quaternion vectors are axial,
    so the handedness reflection contributes one additional sign reversal.
    The fixed bone-basis offset calculated from both rest poses then absorbs
    FBX import roll choices, including automatic_bone_orientation.
    """
    from mathutils import Matrix, Quaternion, Vector
    position = pose['position']
    rotation = pose['rotation']
    translation = Matrix.Translation(Vector((
        -position['x'], -position['z'], position['y'],
    )))
    quaternion = Quaternion((
        rotation['w'], rotation['x'], rotation['z'], -rotation['y'],
    ))
    return translation @ quaternion.to_matrix().to_4x4()


def _set_linear_interpolation(action):
    for curve in action.fcurves:
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = 'LINEAR'


def _blender_bone_name(unity_name, known):
    if unity_name in known:
        return unity_name
    # Unity appends ` 1` to duplicate FBX transform names; Blender uses `.001`.
    # The suffix is deterministic for each importer, so translate it explicitly.
    head, separator, suffix = unity_name.rpartition(' ')
    if separator and suffix.isdigit():
        candidate = f'{head}.{int(suffix):03d}'
        if candidate in known:
            return candidate
    return None


def load_animation_bakes(manifest, output_root, override=None):
    specs = {spec['id']: spec for spec in manifest.get('bakes', [])}
    paths = [os.path.abspath(override)] if override else [
        os.path.join(output_root, *spec['output'].split('/'))
        for spec in specs.values()
    ]
    loaded = {}
    for path in paths:
        if not os.path.isfile(path):
            continue
        with open(path, encoding='utf8') as stream:
            bake = json.load(stream)
        rig_id = bake.get('rigId')
        if rig_id not in specs:
            raise ValueError(
                f'Unity bake {path} has unknown or missing rigId {rig_id!r}'
            )
        loaded[rig_id] = bake
    return loaded


def apply_animation_bake(armature, bake):
    if not bake.get('success'):
        raise ValueError(f'Unity Humanoid bake failed: {bake.get("error", "unknown error")}')
    rest = bake.get('restPose', [])
    if not rest:
        raise ValueError('Unity Humanoid bake has no rest pose')
    known = {bone.name for bone in armature.data.bones}
    bone_map = {
        bone['bone']: _blender_bone_name(bone['bone'], known)
        for bone in rest
    }
    missing = [name for name, mapped in bone_map.items() if mapped is None]
    if missing:
        raise ValueError(
            f'Unity bake and Blender armature differ; missing bones: {missing}'
        )

    from mathutils import Matrix
    armature.animation_data_create()
    inverse_armature = armature.matrix_world.inverted()
    offsets = {}
    for rest_bone in rest:
        name = rest_bone['bone']
        blender_name = bone_map[name]
        unity_rest = _unity_pose_matrix(rest_bone)
        blender_rest = (
            armature.matrix_world @ armature.data.bones[blender_name].matrix_local
        )
        offsets[name] = unity_rest.inverted() @ blender_rest

    sample_rate = int(bake.get('sampleRate', 30))
    bpy.context.scene.render.fps = sample_rate
    actions = []
    for baked_clip in bake.get('clips', []):
        action = bpy.data.actions.new(baked_clip['id'])
        action.use_fake_user = True
        action['escape_work_loop'] = bool(baked_clip.get('loop'))
        action['escape_work_source_clip'] = baked_clip.get('sourceClip', '')
        armature.animation_data.action = action
        for pose_bone in armature.pose.bones:
            pose_bone.rotation_mode = 'QUATERNION'
            pose_bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()

        for baked_frame in baked_clip.get('frames', []):
            # Convert desired world matrices to each bone's local matrix_basis
            # directly. Assigning pose_bone.matrix sequentially lets Blender's
            # dependency graph re-evaluate a keyed parent before its child and
            # can bake a child against stale parent state.
            frame = round(float(baked_frame.get('time', 0)) * sample_rate)
            desired = {}
            for sample in baked_frame.get('bones', []):
                name = sample['bone']
                target_world = _unity_pose_matrix(sample) @ offsets[name]
                desired[bone_map[name]] = inverse_armature @ target_world
            for rest_bone in rest:
                blender_name = bone_map[rest_bone['bone']]
                data_bone = armature.data.bones[blender_name]
                pose_bone = armature.pose.bones[blender_name]
                parent = data_bone.parent
                if parent is not None and parent.name in desired:
                    basis = data_bone.convert_local_to_pose(
                        desired[blender_name], data_bone.matrix_local,
                        parent_matrix=desired[parent.name],
                        parent_matrix_local=parent.matrix_local,
                        invert=True,
                    )
                else:
                    basis = data_bone.convert_local_to_pose(
                        desired[blender_name], data_bone.matrix_local,
                        invert=True,
                    )
                pose_bone.matrix_basis = basis
                pose_bone.keyframe_insert('location', frame=frame, group=blender_name)
                pose_bone.keyframe_insert(
                    'rotation_quaternion', frame=frame, group=blender_name
                )
                pose_bone.keyframe_insert('scale', frame=frame, group=blender_name)
        _set_linear_interpolation(action)
        actions.append(action.name)

    if actions:
        armature.animation_data.action = bpy.data.actions[actions[0]]
    return actions


def convert(job, materials_by_guid, bake=None):
    if bpy is None:
        raise RuntimeError('Character conversion must run under Blender')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source_actions = []
    scale = PROP_CONVERTER.read_global_scale(job['src'])
    bpy.ops.import_scene.fbx(
        filepath=job['src'],
        global_scale=scale,
        automatic_bone_orientation=True,
        use_anim=False,
    )
    source_actions = [action.name for action in bpy.data.actions]

    target = bpy.data.objects.get(job['mesh'])
    if target is None or target.type != 'MESH':
        available = sorted(obj.name for obj in bpy.data.objects if obj.type == 'MESH')
        raise ValueError(
            f'{job["mesh"]!r} is not a mesh in {job["src"]}; available: {available}'
        )
    armatures = [
        modifier.object for modifier in target.modifiers
        if modifier.type == 'ARMATURE' and modifier.object is not None
    ]
    if len(armatures) != 1:
        raise ValueError(
            f'{job["mesh"]!r} must use exactly one armature; found {len(armatures)}'
        )
    armature = armatures[0]

    unique_guids = list(dict.fromkeys(prefab_material_guids(job['prefab'])))
    if len(unique_guids) != 1:
        raise ValueError(
            f'{job["prefab"]} must resolve one shared character material; '
            f'found {unique_guids}'
        )
    material_spec = materials_by_guid.get(unique_guids[0])
    if not material_spec:
        raise ValueError(
            f'Character material GUID {unique_guids[0]} from {job["prefab"]} is unresolved'
        )
    cache = {}
    material = PROP_CONVERTER.build_material(
        material_spec['name'], material_spec, None, cache
    )
    for slot in target.material_slots:
        slot.material = material

    # Export only the chosen body and its shared rig. The monolithic source FBX
    # contains every character variant; shipping them all would multiply each
    # runtime body and make a manifest selection meaningless.
    bpy.ops.object.select_all(action='DESELECT')
    target.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = target
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    armature.animation_data_clear()

    dimensions = _dimensions(target)
    exported_actions = apply_animation_bake(armature, bake) if bake else []
    os.makedirs(os.path.dirname(job['out']), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=job['out'],
        export_format='GLB',
        export_yup=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        export_animations=bool(exported_actions),
        export_animation_mode='ACTIONS',
        export_anim_single_armature=True,
        export_anim_slide_to_zero=True,
        export_force_sampling=True,
        export_skins=True,
        use_selection=True,
    )
    return {
        'mesh': job['mesh'],
        'material': material_spec['name'],
        'material_texture': material_spec.get('texture'),
        'bones': [bone.name for bone in armature.data.bones],
        'source_actions_stripped': source_actions,
        'animations_exported': exported_actions,
        **dimensions,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default=os.path.join(SCRIPT_DIR, 'synty-characters.json'))
    parser.add_argument('--character')
    parser.add_argument('--synty-root')
    parser.add_argument('--animation-root')
    parser.add_argument('--out')
    parser.add_argument('--bake')
    parser.add_argument('--report')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else None)
    synty_root, _animation_root, output_root, jobs, clips, contract = manifest_jobs(
        args.manifest, args.character, args.synty_root, args.animation_root, args.out
    )
    missing_clips = [clip['path'] for clip in clips if not os.path.isfile(clip['path'])]
    if missing_clips:
        print('[synty-character] animation source not mounted; model export continues:')
        for path in missing_clips:
            print(f'  - {path}')
    _materials, materials_by_guid = read_material_libraries(synty_root)
    with open(args.manifest, encoding='utf8') as stream:
        manifest = json.load(stream)
    bakes = load_animation_bakes(manifest, output_root, args.bake)
    if bakes:
        print('[synty-character] Unity Humanoid bakes -> ' + ', '.join(sorted(bakes)))
    else:
        print('[synty-character] Unity Humanoid bakes unavailable; exporting rigs only')
    report = {
        'rig_contract': contract,
        'clips': [{
            'id': clip['id'],
            'path': clip['path'],
            'available': os.path.isfile(clip['path']),
            'loop': clip['loop'],
        } for clip in clips],
        'characters': {},
    }
    for job in jobs:
        bake = bakes.get(job['rig'])
        if bake is None:
            print(
                f'[synty-character] no {job["rig"]} bake for {job["id"]}; '
                'exporting rig only'
            )
        info = convert(job, materials_by_guid, bake)
        report['characters'][job['id']] = info
        print(
            f'[synty-character] OK {job["id"]:30s} '
            f'{info["height"]:.3f}m {len(info["bones"])} bones -> {job["out"]}'
        )
    if args.report:
        report_path = os.path.abspath(args.report)
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, 'w', encoding='utf8') as stream:
            json.dump(report, stream, indent=2, sort_keys=True)
        print(f'[synty-character] report -> {report_path}')


if __name__ == '__main__':
    main()
