// Mulberry32's deterministic stream, shared by seeded fights and the per-turn
// action-bar scramble. The uint form is useful for modulo selection; the
// floating form matches Math.random's [0, 1) contract.
export function mulberry32Uint(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

export function mulberry32(seed) {
  const nextUint = mulberry32Uint(seed);
  return () => nextUint() / 4294967296;
}
