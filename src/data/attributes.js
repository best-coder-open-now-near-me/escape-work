// Player-facing attribute metadata. Attribute order is gameplay-relevant (it
// is the order used by creation, level-up, and the character sheet), while
// labels and blurbs are authored content. Keeping all three together prevents
// the same four concepts from being renamed or explained differently by each
// screen.
export const ATTRIBUTES = Object.freeze([
  Object.freeze({ key: 'grit', label: 'Grit', blurb: 'Toughness — raises max HP.' }),
  Object.freeze({ key: 'hustle', label: 'Hustle', blurb: 'Tempo — raises max AP (move + actions).' }),
  Object.freeze({ key: 'savvy', label: 'Savvy', blurb: 'Precision — raises attack damage.' }),
  Object.freeze({ key: 'composure', label: 'Composure', blurb: 'Poise — softens incoming hits.' }),
]);

export const ATTR_KEYS = Object.freeze(ATTRIBUTES.map(({ key }) => key));
