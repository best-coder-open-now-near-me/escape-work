// The browser/test diagnostic surface for a live fight. This intentionally
// exposes a few mutation doors used by god mode and e2e, but keeps their
// invariants beside the projections they affect instead of embedding another
// large API object inside startCombat.
import { isLivingMember } from './member-rules.js';

export function createCombatDebug(d) {
  return {
    get phase() { return d.phase; },
    // Enough working AI state to distinguish a deliberate wait from a stalled
    // walk or a turn engine that stopped advancing.
    get acting() {
      if (!d.acting) return null;
      const u = d.acting.unit;
      return {
        name: u.def.name,
        ap: d.acting.ap,
        wait: Number(d.acting.wait?.toFixed?.(2) ?? d.acting.wait),
        moving: !!u.moving,
        alive: !!u.alive,
        x: u.x,
        z: u.z,
      };
    },
    get ap() { return d.active.ap; },
    set ap(v) {
      d.active.ap = Math.max(0, d.roundAp(Number(v) || 0));
      d.refresh();
    },
    get bout() {
      return {
        ...d.bout,
        beats: { ...d.bout.beats },
        dmgTaken: d.engaged.reduce((sum, e) => sum + (e.maxHp - Math.max(0, e.hp)), 0),
      };
    },
    get actingAt() {
      const p = d.posOf(d.active);
      return { x: p.x, z: p.z };
    },
    get watching() {
      return [...d.watching.keys()].map((u) => (u.sheet ? u.sheet.name : u.def.name));
    },
    get crouched() {
      return [...d.crouched.entries()].map(([u]) => {
        const state = d.crouchStateOf(u);
        return state && {
          name: d.nameOf(u),
          x: state.at.x,
          z: state.at.z,
          faces: state.faces.map(([ox, oz]) => `${ox},${oz}`),
          covers: d.coverNames(state.at.x, state.at.z, state.faces),
        };
      }).filter(Boolean);
    },
    get freeAp() { return d.active.freeAp || 0; },
    get armed() { return d.intent.armed; },
    get pendingConfirm() { return d.intent.pendingConfirm; },
    get hoverDoor() { return d.aim.hoverDoor; },
    get aimPaint() { return d.aimPaint.debug; },
    get enemies() {
      return d.engaged.map((e) => ({
        name: e.def.name,
        x: e.x,
        z: e.z,
        hp: e.hp,
        alive: e.alive,
        statuses: d.statusList(e),
      }));
    },
    get maxAp() { return d.active.sheet.maxAp; },
    get defended() { return d.hasStatus(d.active.sheet, 'deflecting'); },
    set defended(v) {
      if (v) d.applyStatus(d.active.sheet, 'deflecting');
      else d.removeStatus(d.active.sheet, 'deflecting');
      d.refresh();
    },
    get forceHit() { return d.hits.forceHit; },
    set forceHit(v) { d.hits.setForceHit(v); },
    get forceProc() { return d.hits.forceProc; },
    set forceProc(v) { d.hits.setForceProc(v); },
    get lastRoll() { return d.hits.lastRoll; },
    get hoverHitChance() { return d.aim.hoverHitChance; },
    get lastClickOutcome() { return d.lastClickOutcome; },
    get movePreview() { return !!d.aim.preview; },
    // God mode edits this live ration map in place, then calls refresh().
    get usesLeft() { return d.active.usesLeft; },
    get party() {
      return d.members.map((m) => ({
        name: m.sheet.name,
        hp: m.sheet.hp,
        ap: m.ap,
        active: m === d.active,
        statuses: d.statusList(m.sheet),
      }));
    },
    applyStatus(id, duration, resist = 0, targetName = null) {
      const target = targetName
        ? d.engaged.find((e) => e.alive && e.def.name === targetName)
        : d.active.sheet;
      if (!target) return false;
      const ok = d.applyStatus(target, id, { duration }, resist);
      // Charm must route through the real borrow rather than leaving a hostile
      // carrying only the status marker.
      if (ok && id === 'charmed' && target !== d.active.sheet) {
        d.charmUnit(target, duration ?? d.statuses.charmed.duration);
      }
      d.refresh();
      return ok;
    },
    crouch(targetName) {
      const unit = d.engaged.find((e) => e.alive && e.def.name === targetName);
      if (!unit || !d.crouchHere(unit)) return false;
      d.refresh();
      return true;
    },
    endTurn() {
      d.advanceTurn();
      d.refresh();
    },
    get order() {
      const held = new Set(d.turns.held);
      return d.turns.order.map((slot, i) => ({
        name: d.slotName(slot),
        team: slot.team,
        init: slot.init,
        member: !!slot.member,
        current: i === d.turns.index,
        alive: d.slotAlive(slot),
        held: held.has(slot),
        done: d.turns.isDone(slot),
      }));
    },
    get turn() { return d.turns.current ? d.slotName(d.turns.current) : null; },
    get summons() {
      return d.members.filter((m) => m.isSummon && isLivingMember(m))
        .map((m) => ({
          name: m.sheet.name,
          x: m.actor.x,
          z: m.actor.z,
          hp: m.sheet.hp,
          turnsLeft: m.actor.summonTurns,
        }));
    },
    summonAlly(id, n = 1, lifetimeTurns = null) {
      return d.resolveSummon(d.active.actor, 'player', {
        archetype: id,
        count: n,
        cap: n,
        lifetimeTurns,
      });
    },
    refresh: (...args) => d.refresh(...args),
  };
}
