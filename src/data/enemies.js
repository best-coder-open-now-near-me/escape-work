// Enemy type registry. Adding an enemy = adding an entry here and giving it a
// character in a level's "actors" legend. `model` is a .glb under
// assets/characters/. `attacks` are picked at random each enemy turn; the log
// line gets the rolled damage appended. `loot` (data/items.js ids) rolls onto
// their body when they fall - bodies stay on the floor and can be looted.
//
// `aggression` is their disposition toward starting a fight, surfaced as the
// dots flanking their name in the focus banner:
//   'green'  - no intention of initiating; only fights if provoked
//   'yellow' - will talk first, then maybe escalate
//   'red'    - straight to battle
export const ENEMY_TYPES = {
  manager: {
    char: 'M',
    name: 'The Manager',
    model: 'manager',
    level: 1, // native tier; a floor deeper than this scales him up (stats.scaleEnemy)
    hp: 14,
    ap: 5,
    attackAp: 3, // AP one swing costs them in combat
    xp: 8,
    aggression: 'red', // straight to battle
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
      // applies: 'gum' - sticks gum to the target's shoe (see GUM in surfaces.js)
      { min: 1, max: 2, log: 'The Manager parks his gum on your shoe. A power move.', applies: 'gum' },
    ],
  },
  executive: {
    char: 'E',
    name: 'The Executive',
    model: 'midmanager',
    level: 2, // descended from the floors above - a tier over the base Manager
    hp: 18,
    ap: 5,
    attackAp: 3,
    xp: 10,
    aggression: 'red', // descended from the floors above; negotiation is beneath him
    examine: 'An Executive, down from the floors above. The air pressure changes around him.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.35 },
      { item: 'cold-coffee', chance: 0.5 },
    ],
    attacks: [
      { min: 3, max: 5, log: 'The Executive restructures your reporting line.' },
      { min: 2, max: 4, log: 'The Executive asks what it is you even do here.' },
      { min: 2, max: 5, log: 'The Executive aligns you with the new strategy.' },
      { min: 1, max: 2, log: 'The Executive parks his gum on your shoe. Delegation.', applies: 'gum' },
    ],
  },
  hr: {
    char: 'H',
    name: 'HR Representative',
    model: 'hr',
    level: 1,
    hp: 12,
    ap: 6,
    attackAp: 3,
    xp: 6,
    aggression: 'yellow', // wants a "culture-fit conversation" before the knives
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
    // HR's power (SUMMON_PLAN.md): posts the role and applicants materialize to
    // fight for it. `archetype` names a unit (the `applicant` class); `cap` is
    // how many it may have live at once; `cooldownRounds` is the wait between
    // reqs; `ap` is what the post costs its turn. The combat AI reads this.
    summon: {
      archetype: 'applicant',
      count: 2,
      cap: 2,
      cooldownRounds: 2,
      ap: 3,
      log: 'HR posts the role internally. Applicants materialize, résumés in hand.',
    },
  },

  // --- seniority variants (higher native tier) --------------------------------
  // Tougher relatives of the base coworkers: new data entries reusing existing
  // rigs, with a higher native `level` (beefier base stats, better loot, meaner
  // lines). The floor curve (stats.scaleEnemy) scales THESE too on floors past
  // their tier; place them where a floor wants a step up. Nothing else is code.
  'senior-manager': {
    char: 'G',
    name: 'Senior Manager',
    model: 'manager', // reuses the Manager rig until a dedicated .glb lands
    level: 3,
    hp: 22,
    ap: 5,
    attackAp: 3,
    xp: 15,
    aggression: 'red',
    examine: 'A Senior Manager. Same energy, more direct reports. Radiates escalation.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.3 },
      { item: 'cold-coffee', chance: 0.5 },
    ],
    attacks: [
      { min: 3, max: 4, log: 'The Senior Manager loops in their manager.' },
      { min: 3, max: 5, log: 'The Senior Manager moves the goalposts, then the deadline.' },
      { min: 2, max: 4, log: '"Let\'s take this offline." (It is never taken offline.)' },
      { min: 1, max: 2, log: 'The Senior Manager parks premium gum on your shoe.', applies: 'gum' },
    ],
  },
  'regional-executive': {
    char: 'X',
    name: 'Regional Executive',
    model: 'midmanager',
    level: 4,
    hp: 30,
    ap: 5,
    attackAp: 3,
    xp: 22,
    aggression: 'red',
    examine: 'A Regional Executive. Flew in for the day. Knows your name, not your work.',
    loot: [
      { item: 'performance-review', chance: 1 },
      { item: 'red-stapler', chance: 0.5 },
      { item: 'cold-coffee', chance: 0.5 },
    ],
    attacks: [
      { min: 4, max: 6, log: 'The Regional Executive announces a "strategic realignment".' },
      { min: 3, max: 6, log: 'The Regional Executive sunsets your entire team.' },
      { min: 3, max: 5, log: 'The Regional Executive asks for a number you do not have.' },
    ],
  },
};
