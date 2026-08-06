"""Pure Unity material-sidecar parsing for the FBX conversion pipeline.

This module deliberately has no Blender dependency. Keeping Unity YAML/GUID
resolution here lets it be tested with plain Python before Blender is present,
and supports both the older single-atlas office pack and newer Synty packs
whose materials point at textures through `_Albedo_Map` GUIDs.
"""

import os
import re


TEXTURE_SLOTS = ('_MainTex', '_Albedo_Map', '_BaseMap')
COLOR_SLOTS = ('_BaseColor', '_Color')


def _first_texture_ref(text):
    """Return (uses_texture, guid) for the first supported albedo slot."""
    slots = '|'.join(re.escape(slot) for slot in TEXTURE_SLOTS)
    match = re.search(
        rf'-\s+(?:{slots}):\s*\r?\n'
        r'\s*m_Texture:\s*\{fileID:\s*(\d+)'
        r'(?:,\s*guid:\s*([0-9a-fA-F]+),\s*type:\s*\d+)?\}',
        text,
    )
    if not match:
        return False, None
    file_id, guid = match.groups()
    return file_id != '0', guid.lower() if guid else None


def _first_color(text):
    for slot in COLOR_SLOTS:
        match = re.search(
            rf'-\s+{re.escape(slot)}:\s*\{{r:\s*([\d.eE+-]+),'
            r'\s*g:\s*([\d.eE+-]+),\s*b:\s*([\d.eE+-]+),'
            r'\s*a:\s*([\d.eE+-]+)\}',
            text,
        )
        if match:
            return tuple(float(value) for value in match.groups())
    return (1.0, 1.0, 1.0, 1.0)


def guid_index(pack_dir):
    """Map Unity asset GUIDs to the source file beside each `.meta` file."""
    result = {}
    for root, _dirs, files in os.walk(pack_dir):
        for filename in files:
            if not filename.endswith('.meta'):
                continue
            meta_path = os.path.join(root, filename)
            try:
                with open(meta_path, encoding='utf8', errors='replace') as stream:
                    head = stream.read(2048)
            except OSError:
                continue
            match = re.search(r'^guid:\s*([0-9a-fA-F]+)\s*$', head, re.M)
            if not match:
                continue
            asset_path = meta_path[:-5]
            if os.path.isfile(asset_path):
                result[match.group(1).lower()] = asset_path
    return result


def read_materials(pack_dir):
    """Build a case-insensitive material specification map.

    `texture` is the concrete source texture when the material carries a GUID.
    `uses_texture` remains true without one so the legacy converter can use its
    single-atlas fallback.
    """
    assets_by_guid = guid_index(pack_dir)
    materials = {}
    for root, _dirs, files in os.walk(pack_dir):
        for filename in files:
            if not filename.endswith('.mat'):
                continue
            path = os.path.join(root, filename)
            with open(path, encoding='utf8', errors='replace') as stream:
                text = stream.read()
            uses_texture, texture_guid = _first_texture_ref(text)
            materials[os.path.splitext(filename)[0].lower()] = {
                'color': _first_color(text),
                'uses_texture': uses_texture,
                'texture': assets_by_guid.get(texture_guid),
                'texture_guid': texture_guid,
            }
    return materials
