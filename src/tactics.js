// Tactical positioning: the rules that make WHERE a unit stands matter
// (TACTICS_PLAN.md). Pure - no PlayCanvas, no DOM, no grid, no combat. Every
// function here takes already-resolved numbers or plain coordinates, so the
// rules unit-test without standing up a fight.
//
// Milestone 1 lands only the assembler. Before it, FOUR sites in combat.js
// (the hover preview, the melee swing, the cone, and the AI's swing) each
// summed the to-hit terms by hand - which meant the percentage on screen was
// a reimplementation of the roll rather than a read of it, and any term added
// to one and not the others would make the UI lie. Now there is one place.
//
// `positional` is the seam the later milestones fill in (cover, flanking,
// backstab). It is 0 everywhere today, so this milestone changes no number.
import { HIT } from './stats.js';

// The to-hit terms for one attacker/defender pair, in the shape
// stats.hitChance consumes: { acc, dodge, mods }.
//
//   accuracy   attacker's accuracy - attributes and gear already folded in
//   dodge      defender's dodge, likewise
//   surprised  defender hasn't registered the fight yet (HIT_PLAN #6)
//   accMod     attacker's status accuracy modifier (a blinded attacker aims worse)
//   dodgeMod   defender's status dodge modifier
//   positional cover / flanking / backstab (TACTICS_PLAN milestones 3-5)
export function toHitTerms({
  accuracy = 0,
  dodge = 0,
  surprised = false,
  accMod = 0,
  dodgeMod = 0,
  positional = 0,
} = {}) {
  return {
    acc: accuracy + (surprised ? HIT.SURPRISE_ACC_BONUS : 0) + accMod,
    dodge: dodge + dodgeMod,
    mods: positional,
  };
}
