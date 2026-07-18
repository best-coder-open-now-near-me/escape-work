// Level registry. A level's optional "next" field names the level its exit
// leads to; a level without "next" ends the campaign (you escape). The editor
// offers these as bases to edit.
import level1 from '../../levels/level1.json';
import level2 from '../../levels/level2.json';

export const LEVELS = { level1, level2 };
export const FIRST_LEVEL = 'level1';
