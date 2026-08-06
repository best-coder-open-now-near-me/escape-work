// The parts of Take Cover that do not belong to combat or exploration.
// Walking and AP are context-specific; what shields a face, what refuses a
// spot, and how a body enters/leaves the held crouch are not.
import { shieldsCell } from './data/tiles.js';
import { shieldedFaces } from './tactics.js';

export const CROUCH_NO_ROOM = 'No room to tuck in there.';
export const CROUCH_NO_COVER = 'Nothing there to hide behind.';

export function crouchProblem({ here, roomFree, faces }) {
  if (!here && !roomFree) return CROUCH_NO_ROOM;
  if (!faces) return CROUCH_NO_COVER;
  return null;
}

// Props and bodies answer the same cover-cell question in either game mode.
// Callers adapt their body storage through bodyAt; exclusions keep the
// croucher and the attacker from becoming their own cover.
export function crouchCoverCell(x, z, {
  tileDefAt,
  bodyAt,
  standing = () => true,
  exclude = [],
}) {
  if (shieldsCell(tileDefAt(x, z))) return true;
  const body = bodyAt(x, z);
  return !!body && !exclude.includes(body) && standing(body);
}

export function crouchFacesAt(x, z, world) {
  return shieldedFaces(x, z, {
    edgeOpen: world.edgeOpen,
    coverCell: (cx, cz) => crouchCoverCell(cx, cz, world),
  });
}

export function enterCrouch({ body, carrier, faces, setState, applyStatus }) {
  if (!body || !faces?.length) return null;
  const state = { at: { x: body.x, z: body.z }, faces };
  setState(state);
  body.crouched = true;
  applyStatus(carrier, 'covered');
  return state;
}

export function leaveCrouch({ body, carrier, clearState, removeStatus }) {
  if (!clearState()) return false;
  removeStatus(carrier, 'covered');
  if (body) body.crouched = false;
  return true;
}
