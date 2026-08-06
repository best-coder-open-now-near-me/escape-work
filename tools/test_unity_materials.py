import os
import importlib.util
import tempfile
import unittest

from unity_materials import prefab_material_guids, read_material_libraries, read_materials


CONVERTER_SPEC = importlib.util.spec_from_file_location(
    'fbx_to_glb', os.path.join(os.path.dirname(__file__), 'fbx-to-glb.py')
)
CONVERTER = importlib.util.module_from_spec(CONVERTER_SPEC)
CONVERTER_SPEC.loader.exec_module(CONVERTER)


class UnityMaterialsTests(unittest.TestCase):
    def test_resolves_synty_albedo_guid_and_base_color(self):
        with tempfile.TemporaryDirectory() as root:
            texture = os.path.join(root, 'shops.png')
            with open(texture, 'wb') as stream:
                stream.write(b'png')
            with open(texture + '.meta', 'w', encoding='utf8') as stream:
                stream.write('fileFormatVersion: 2\nguid: abc123\n')
            with open(os.path.join(root, 'shops.mat'), 'w', encoding='utf8') as stream:
                stream.write(
                    '    - _Albedo_Map:\n'
                    '        m_Texture: {fileID: 2800000, guid: abc123, type: 3}\n'
                    '    - _BaseColor: {r: 0.1, g: 0.2, b: 0.3, a: 1}\n'
                )

            spec = read_materials(root)['shops']
            self.assertEqual(spec['texture'], texture)
            self.assertEqual(spec['color'], (0.1, 0.2, 0.3, 1.0))
            self.assertTrue(spec['uses_texture'])

    def test_legacy_main_texture_without_guid_keeps_atlas_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, 'legacy.mat'), 'w', encoding='utf8') as stream:
                stream.write(
                    '    - _MainTex:\n'
                    '        m_Texture: {fileID: 2800000}\n'
                    '    - _Color: {r: 1, g: 0.5, b: 0.25, a: 1}\n'
                )

            spec = read_materials(root)['legacy']
            self.assertIsNone(spec['texture'])
            self.assertTrue(spec['uses_texture'])
            self.assertEqual(spec['color'], (1.0, 0.5, 0.25, 1.0))

    def test_empty_texture_slot_does_not_claim_the_fallback_atlas(self):
        with tempfile.TemporaryDirectory() as root:
            with open(os.path.join(root, 'flat.mat'), 'w', encoding='utf8') as stream:
                stream.write(
                    '    - _MainTex:\n'
                    '        m_Texture: {fileID: 0}\n'
                )

            spec = read_materials(root)['flat']
            self.assertFalse(spec['uses_texture'])
            self.assertIsNone(spec['texture'])

    def test_material_library_indexes_a_material_by_its_unity_guid(self):
        with tempfile.TemporaryDirectory() as root:
            material = os.path.join(root, 'shops.mat')
            with open(material, 'w', encoding='utf8') as stream:
                stream.write('    - _Color: {r: 1, g: 1, b: 1, a: 1}\n')
            with open(material + '.meta', 'w', encoding='utf8') as stream:
                stream.write('fileFormatVersion: 2\nguid: feed1234\n')

            by_name, by_guid = read_material_libraries(root)
            self.assertIs(by_name['shops'], by_guid['feed1234'])

    def test_prefab_material_assignments_are_read_in_renderer_order(self):
        with tempfile.TemporaryDirectory() as root:
            prefab = os.path.join(root, 'desk.prefab')
            with open(prefab, 'w', encoding='utf8') as stream:
                stream.write(
                    '  m_Materials:\n'
                    '  - {fileID: 2100000, guid: abc123, type: 2}\n'
                    '  - {fileID: 2100000, guid: def456, type: 2}\n'
                )
            self.assertEqual(prefab_material_guids(prefab), ['abc123', 'def456'])

    def test_manifest_selects_a_wave_and_preserves_authored_output_and_grounding(self):
        with tempfile.TemporaryDirectory() as root:
            source_root = os.path.join(root, 'source')
            output_root = os.path.join(root, 'output')
            os.makedirs(os.path.join(source_root, 'Pack', 'Models'))
            source = os.path.join(source_root, 'Pack', 'Models', 'desk.fbx')
            with open(source, 'wb') as stream:
                stream.write(b'fbx')
            manifest_path = os.path.join(root, 'manifest.json')
            with open(manifest_path, 'w', encoding='utf8') as stream:
                stream.write(
                    '{"sourceRoot":"ignored","outputRoot":"ignored",'
                    '"waves":[{"id":"core","assets":[{'
                    '"id":"desk","source":"Pack/Models/desk.fbx",'
                    '"output":"office/desk.glb","ground":false}]}]}'
                )

            resolved_source, resolved_output, jobs = CONVERTER.manifest_jobs(
                manifest_path, 'core', source_root, output_root
            )
            self.assertEqual(resolved_source, source_root)
            self.assertEqual(resolved_output, output_root)
            self.assertEqual(jobs, [{
                'id': 'desk',
                'wave': 'core',
                'src': source,
                'out': os.path.join(output_root, 'office', 'desk.glb'),
                'ground': False,
            }])


if __name__ == '__main__':
    unittest.main()
