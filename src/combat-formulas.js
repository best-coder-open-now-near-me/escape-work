// PLAYER-FACING COMBAT MATH.
//
// These formatters take the values the resolvers already used. They never
// recalculate a chance or damage result, which keeps the diagnostic dialogue
// honest when a rule changes: resolution owns the arithmetic; this module only
// makes that arithmetic readable.

const pct = (value) => {
  const n = Math.round((value || 0) * 1000) / 10;
  return `${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}%`;
};

const signed = (label, value) => {
  const n = value || 0;
  return `${n < 0 ? '−' : '+'} ${label} ${pct(Math.abs(n))}`;
};

export function formatHitFormula({
  attacker, target, base, accuracy = 0, dodge = 0, position = 0,
  clampLow, clampHigh, chance, roll = null, forced = null, hit,
}) {
  const terms = [
    pct(base),
    signed('accuracy', accuracy),
    signed('dodge', -dodge),
    signed('position', position),
  ].join(' ');
  const resolved = forced === null
    ? `roll ${pct(roll)} → ${hit ? 'HIT' : 'MISS'}`
    : `debug pin ${forced ? 'hit' : 'miss'} → ${hit ? 'HIT' : 'MISS'}`;
  return `Hit · ${attacker} → ${target}: clamp(${terms}, ${pct(clampLow)}–${pct(clampHigh)}) = ${pct(chance)}; ${resolved}.`;
}

export function formatProcFormula({ attacker, target, label, chance, roll = null, forced = null, hit }) {
  const resolved = forced === null
    ? `roll ${pct(roll)}`
    : `debug pin ${forced ? 'proc' : 'no proc'}`;
  return `Proc · ${attacker} → ${target} (${label}): ${pct(chance)}; ${resolved} → ${hit ? 'PROC' : 'NO PROC'}.`;
}

export function formatDamageFormula({
  attacker, target, action, roll, min, max, additions = [], stages = [], result,
}) {
  const extras = additions
    .filter(({ value }) => value !== 0)
    .map(({ label, value }) => ` ${value < 0 ? '−' : '+'} ${label} ${Math.abs(value)}`)
    .join('');
  const subtotal = roll + additions.reduce((sum, term) => sum + term.value, 0);
  const steps = stages
    .filter(({ before, after }) => before !== after)
    .map(({ label, before, after }) => `${label}: ${before} → ${after}`);
  const detail = [`roll ${roll} (${min}–${max})${extras} = ${subtotal}`, ...steps].join('; ');
  return `Damage · ${attacker} → ${target} (${action}): ${detail}; total ${result}.`;
}
