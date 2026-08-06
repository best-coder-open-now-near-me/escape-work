// Player-facing names for whatever shields one or more cell faces. The world
// supplies body/tile lookup because combat and exploration store their actors
// differently; article and list formatting stay identical on both sides.
export function coverNameAt(x, z, { bodyAt, nameOf, tileDefAt }, article = false) {
  const body = bodyAt(x, z);
  if (body) return nameOf(body);
  const def = tileDefAt(x, z);
  const label = def && (def.cover || def.solid)
    ? (def.label || 'cover').toLowerCase()
    : 'partition';
  return article ? `the ${label}` : label;
}

export function coverNames(x, z, faces, world) {
  const seen = [];
  for (const [ox, oz] of faces || []) {
    const label = coverNameAt(x + ox, z + oz, world, true);
    if (!seen.includes(label)) seen.push(label);
  }
  if (!seen.length) return 'cover';
  if (seen.length === 1) return seen[0];
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`;
}
