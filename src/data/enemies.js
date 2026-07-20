// Enemy type registry. Adding an enemy = adding an entry here and giving it a
// character in a level's "actors" legend. `model` is a .glb under
// assets/characters/. `attacks` are picked at random each enemy turn; the log
// line gets the rolled damage appended. `loot` (data/items.js ids) rolls onto
// their body when they fall - bodies stay on the floor and can be looted.
export const ENEMY_TYPES = {
  manager: {
    char: 'M',
    name: 'The Manager',
    model: 'manager',
    hp: 14,
    ap: 5,
    xp: 8,
    examine: 'The Manager: radiates unread-email energy.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'cold-coffee', chance: 0.5 },
    ],
    attacks: [
      { min: 2, max: 3, log: 'The Manager schedules a "quick sync".' },
      { min: 2, max: 3, log: 'The Manager asks for "just one more thing".' },
      { min: 2, max: 3, log: 'The Manager CCs your skip-level.' },
      { min: 2, max: 4, log: '"Per my last email..."' },
    ],
  },
  hr: {
    char: 'H',
    name: 'HR Representative',
    model: 'hr',
    hp: 12,
    ap: 6,
    xp: 6,
    examine: 'HR: smiles warmly. Never stops taking notes.',
    loot: [
      { item: 'hr-pamphlet', chance: 1 },
      { item: 'half-sandwich', chance: 0.4 },
    ],
    attacks: [
      { min: 2, max: 3, log: 'HR invites you to a "culture-fit conversation".' },
      { min: 2, max: 4, log: 'HR slides a self-evaluation form across the desk.' },
      { min: 1, max: 4, log: 'HR reminds you fun is mandatory at the offsite.' },
    ],
  },
};
