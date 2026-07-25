// Level registry. A level's optional "next" field names the level its exit
// leads to; a level without "next" ends the campaign (you escape). The editor
// offers these as bases to edit.
// The `with { type: 'json' }` attribute is required by Node's ESM loader (and
// standard); esbuild honors it too. Without it this module bundles fine but
// cannot be imported by the node --test unit suite - which is why the level
// lint could only check the files on disk, never the registry the game reads.
import level1 from '../../levels/level1.json' with { type: 'json' };
import level2 from '../../levels/level2.json' with { type: 'json' };

export const LEVELS = { level1, level2 };
export const FIRST_LEVEL = 'level1';
