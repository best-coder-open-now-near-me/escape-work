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
};
