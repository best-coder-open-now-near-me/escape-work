// Canonical grid-neighbour offsets. Geometry, pathing, simulation, previews,
// lint and editor tools all need these exact iteration orders; declaring them
// once prevents a subsystem from quietly dropping diagonals or inventing a
// different cardinal scan order.
export const CARDINAL_DIRS = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([-1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([0, -1]),
]);

export const DIAGONAL_DIRS = Object.freeze([
  Object.freeze([1, 1]),
  Object.freeze([1, -1]),
  Object.freeze([-1, 1]),
  Object.freeze([-1, -1]),
]);

export const NEIGHBOR_DIRS = Object.freeze([...CARDINAL_DIRS, ...DIAGONAL_DIRS]);
