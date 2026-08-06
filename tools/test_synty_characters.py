import importlib.util
import json
import os
import tempfile
import unittest


SCRIPT_DIR = os.path.dirname(__file__)
SPEC = importlib.util.spec_from_file_location(
    'synty_character_to_glb', os.path.join(SCRIPT_DIR, 'synty-character-to-glb.py')
)
CONVERTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONVERTER)


class SyntyCharacterManifestTests(unittest.TestCase):
    def test_resolves_separate_model_animation_and_output_roots(self):
        with tempfile.TemporaryDirectory() as root:
            synty = os.path.join(root, 'synty')
            animations = os.path.join(root, 'animations')
            output = os.path.join(root, 'output')
            os.makedirs(synty)
            os.makedirs(animations)
            manifest = os.path.join(root, 'manifest.json')
            with open(manifest, 'w', encoding='utf8') as stream:
                json.dump({
                    'syntyRoot': 'unused',
                    'animationRoot': 'unused',
                    'outputRoot': 'unused',
                    'rigContract': {'runtimeClips': ['idle']},
                    'clips': [{
                        'id': 'idle', 'source': 'Unarmed/Idle.fbx',
                        'sourceClip': 'Idle', 'loop': True,
                    }],
                    'characters': [{
                        'id': 'worker', 'source': 'Pack/Characters.fbx',
                        'mesh': 'Worker', 'prefab': 'Pack/Worker.prefab',
                        'output': 'characters/worker.glb',
                    }],
                }, stream)

            resolved = CONVERTER.manifest_jobs(
                manifest, 'worker', synty, animations, output
            )
            self.assertEqual(resolved[0:3], (synty, animations, output))
            self.assertEqual(resolved[3], [{
                'id': 'worker',
                'mesh': 'Worker',
                'src': os.path.join(synty, 'Pack', 'Characters.fbx'),
                'prefab': os.path.join(synty, 'Pack', 'Worker.prefab'),
                'out': os.path.join(output, 'characters', 'worker.glb'),
            }])
            self.assertEqual(
                resolved[4][0]['path'], os.path.join(animations, 'Unarmed', 'Idle.fbx')
            )

    def test_unknown_character_is_named_before_blender_runs(self):
        manifest = os.path.join(SCRIPT_DIR, 'synty-characters.json')
        with self.assertRaisesRegex(ValueError, 'Unknown character'):
            CONVERTER.manifest_jobs(manifest, 'does-not-exist')

    def test_checked_in_contract_covers_every_runtime_clip(self):
        manifest = os.path.join(SCRIPT_DIR, 'synty-characters.json')
        with open(manifest, encoding='utf8') as stream:
            data = json.load(stream)
        selected = {clip['id'] for clip in data['clips']}
        self.assertTrue(set(data['rigContract']['runtimeClips']).issubset(selected))
        self.assertEqual(len(selected), len(data['clips']))
        character_ids = [character['id'] for character in data['characters']]
        self.assertEqual(len(character_ids), len(set(character_ids)))

    def test_bake_uses_a_known_humanoid_body_and_private_output(self):
        manifest = os.path.join(SCRIPT_DIR, 'synty-characters.json')
        with open(manifest, encoding='utf8') as stream:
            data = json.load(stream)
        character_ids = {character['id'] for character in data['characters']}
        self.assertIn(data['bake']['characterId'], character_ids)
        self.assertGreaterEqual(data['bake']['sampleRate'], 24)
        self.assertEqual(data['bake']['rootMotion'], 'in-place')
        self.assertTrue(data['bake']['output'].endswith('.json'))
        self.assertTrue(data['outputRoot'].startswith('assets/licensed/'))


if __name__ == '__main__':
    unittest.main()
