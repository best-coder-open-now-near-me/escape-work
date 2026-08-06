// ONE DESCRIPTION OF A POWER, wherever the player meets it.
//
// The authored sentence lives only on data/actions.js `desc`. This formatter
// composes that data with rule-derived facts and optional live character state
// for the hotbar. A level-up unlock calls the same function with the prospective
// owner's sheet, so it cannot explain a different power from the slot that
// appears after purchase.
import { ACTIONS } from './data/actions.js';
import { STATUSES } from './data/statuses.js';
import {
  aimsAtAlly, buffRangeOf, dashDistanceOf, isControl, isFriendly, isMobility,
  isPull, isStance, isZone, mobilityRangeOf, watchRadiusOf, zoneRadiusOf,
  zoneRangeOf,
} from './powers.js';
import { ammoCostOf, damageBonus, rangeOf } from './stats.js';

export function actionTooltip(id, {
  sheet = null,
  ammoCost = null,
  ammoRemaining = sheet?.paper ?? null,
  usesLeft = null,
} = {}) {
  const a = ACTIONS[id];
  if (!a) return '';
  const out = [`${a.label} - ${a.ap} AP`];
  if (a.desc) out.push(a.desc);
  if (a.min != null && a.max != null) {
    const bonus = sheet ? damageBonus(sheet) : 0;
    out.push(`Damage ${a.min}-${a.max}${bonus ? ` +${bonus}` : ''}`);
  }
  if (a.amount) out.push(`Restores ${a.amount} HP`);
  if (a.cone) out.push(`Cone - ${a.cone.range} tiles, ${a.cone.halfAngle * 2} degrees wide`);
  const range = rangeOf(id);
  if (range && !a.cone) out.push(`Range ${range} tiles - needs a clear line`);
  if (a.ammoCost) {
    const cost = ammoCost ?? (sheet ? ammoCostOf(sheet, id) : a.ammoCost);
    out.push(ammoRemaining == null
      ? `Costs ${cost} paper`
      : `Costs ${cost} paper (you have ${ammoRemaining})`);
  }
  if (a.uses) {
    out.push(usesLeft == null
      ? `${a.uses} use${a.uses === 1 ? '' : 's'} per fight`
      : `${usesLeft} of ${a.uses} uses left this fight`);
  }
  if (a.applies) out.push(`Applies ${STATUSES[a.applies]?.name || a.applies}`);
  if (a.purge) out.push('Clears every status - the good ones too');
  if (isFriendly(a)) out.push(`Aim at a teammate or yourself - range ${buffRangeOf(a)}, never misses`);
  if (isControl(a)) out.push('No damage - it takes their turn or their ground, not their HP');
  if (a.type === 'cover') {
    out.push('Aim at furniture, a tile against a partition, or a teammate; you walk over and tuck in (the walk bills as movement)');
    out.push('Ranged attacks from the shielded side cannot touch you - melee and flanking still can');
    out.push('Moving breaks it; attacking does not');
  }
  if (isPull(a)) {
    out.push('Aim at an enemy dug in behind cover, from its far side - you reach over and haul them past you, clear of what they were tucked behind');
    out.push(`Grit save: pass lands them on their feet, fail is ${a.crush[0]}-${a.crush[1]} damage, a skipped turn (${STATUSES.stunned.name}) and pinned`);
    out.push('Their cover stays standing');
  }
  if (isStance(a)) {
    out.push(`Watches ${watchRadiusOf(a)} tiles until your next turn`);
    out.push('Spends your reaction when it fires - one per round, shared with opportunity attacks');
  }
  if (isMobility(a)) {
    out.push(aimsAtAlly(a)
      ? `Trade places with a teammate - range ${mobilityRangeOf(a)}`
      : `Move up to ${dashDistanceOf(a)} tiles for a flat ${a.ap} AP`);
    out.push('Provokes no opportunity attacks');
  }
  if (isZone(a)) out.push(`Covers a ${zoneRadiusOf(a) * 2}-tile area with ${a.leaves} - range ${zoneRangeOf(a)}`);
  if (a.footwork) out.push('Footwork - gum on your shoe prevents it');
  return out.join('\n');
}
