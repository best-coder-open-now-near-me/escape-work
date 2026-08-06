// SPENDING WHAT A PROMOTION PAID OUT, and the two screens that show it.
//
// A slice off `startGame` (Q039): the level-up allocation flow, the read-only
// character sheet, and the one function - `refreshProgressUi` - that every
// spend routes through so the HUD, the hotbar, the party bar's pips and an open
// sheet cannot disagree about what was just bought.
//
// Points bank on the sheet (stats.gainXp); the player spends them here. Every
// member is built by hand - nothing auto-allocates (PROGRESSION_PLAN #7).
//
// Why this is a seam: nothing in here touches the world. It reads a sheet, maps
// it to a view-model, and hands it to `ui`. The two widgets it owns
// (`levelUpPip`, `charSheet`) were built mid-closure purely because the
// callbacks they take - `onOpen: openLevelUps` - are declared alongside them,
// and that mutual reference is the whole cluster.
//
// The one thing it reaches back out for is `setPartyBarKey('')`: the party bar
// renders a pip per companion off a gate key, and a spend has to force it to
// re-render. The bar itself stays in the frame loop, so the key stays there
// too, and this writes it through a named setter rather than owning it.
import { actionTooltip } from './action-tooltip.js';

export function createProgressionUi(d) {
  // A short human blurb for a track node's effect, for the screen.
  function describeNode(effect = {}) {
    const bits = [];
    if (effect.attrBonus) for (const [k, v] of Object.entries(effect.attrBonus)) bits.push(`+${v} ${k[0].toUpperCase() + k.slice(1)}`);
    if (effect.grantsAction) bits.push(`Unlock ${d.ACTIONS[effect.grantsAction]?.label || effect.grantsAction}`);
    if (effect.talent) for (const [k, v] of Object.entries(effect.talent)) bits.push(typeof v === 'number' ? `+${v} ${k}` : k);
    return bits.join(' · ') || 'A perk.';
  }
  // The sheet's track as screen view-models (taken / locked / affordable).
  function trackNodesFor(sheet_) {
    return d.classTrack(sheet_).map((n) => {
      const actionId = n.effect?.grantsAction || null;
      return {
        id: n.id, name: n.name, cost: n.cost || 1, desc: describeNode(n.effect),
        actionId,
        // The exact presentation the new hotbar slot will use after learning.
        // `desc` remains authored once, on ACTIONS; this screen never copies it.
        tooltip: actionId ? actionTooltip(actionId, { sheet: sheet_ }) : null,
        taken: (sheet_.perks || []).includes(n.id),
        locked: !!(n.requires && !n.requires.every((r) => (sheet_.perks || []).includes(r))),
        affordable: (sheet_.classPoints || 0) >= (n.cost || 1),
      };
    });
  }
  // Read-only character sheet (press C). A plain view-model - this owns the
  // derived math (damageBonus/deflect) and the perk names.
  function charSheetVm(s) {
    return {
      name: s.name, className: s.className, level: s.level, xp: s.xp, xpNext: s.xpNext,
      attr: { ...s.attr }, hp: s.hp, maxHp: s.maxHp, maxAp: s.maxAp,
      damageBonus: d.damageBonus(s), deflect: d.deflect(s),
      equipped: Object.fromEntries(d.EQUIP_SLOTS.map((slot) => [slot, d.ITEMS[s.equipped?.[slot]]?.name || null])),
      talent: s.talent ? { name: s.talent.name } : null,
      perks: (s.perks || []).map((id) => d.trackNode(id)?.name || id),
      attrPoints: s.attrPoints || 0, classPoints: s.classPoints || 0,
    };
  }
  function refreshProgressUi() {
    if (d.sheet) { d.paintHud(d.sheet); d.buildHotbar(); } // a learned action joins the bar
    d.setPartyBarKey(''); // force the bar to re-render its pips next frame
    levelUpPip.refresh(!d.inCombat && !d.gameOver && d.sheet ? d.pending(d.sheet) : 0);
    if (d.sheet) charSheet.refresh(charSheetVm(d.sheet)); // keep an open sheet live
  }
  function openLevelUpFor(member, after) {
    if (!member) { after?.(); return; }
    d.ui.showLevelUpScreen(member.sheet, {
      onSpend: (attr) => { d.spendAttrPoint(member.sheet, attr); refreshProgressUi(); },
      onLearn: (nodeId) => { d.spendClassPoint(member.sheet, nodeId); refreshProgressUi(); },
      nodesFor: () => trackNodesFor(member.sheet),
      onDone: () => { refreshProgressUi(); after?.(); },
    });
  }
  // Page through every member still holding points (of either type), one screen
  // at a time.
  function openLevelUps() {
    if (!d.party) return;
    // `spendablePoints`, not `pending`: class points keep accruing per level
    // while a track is finite, so a bought-out member reopened this fullscreen
    // modal after every victory with nothing purchasable (Q068). The character
    // sheet and the party bar keep showing `pending` - the points ARE banked,
    // and hiding them would be a different lie. This is only the decision to
    // interrupt.
    const queue = d.party.members.filter((m) => d.spendablePoints(m.sheet) > 0);
    let i = 0;
    const next = () => (i < queue.length ? openLevelUpFor(queue[i++], next) : refreshProgressUi());
    next();
  }

  // Declared after the functions they call: both widgets take a callback that
  // opens the level-up flow, and that mutual reference is why the pip, the
  // sheet and the flow are one cluster. Function declarations hoist, so the
  // callbacks are bound by the time `ui` can fire them.
  const levelUpPip = d.ui.createLevelUpPip({ onOpen: openLevelUps });
  const charSheet = d.ui.createCharacterSheet({ onLevelUp: () => openLevelUps() });

  return {
    levelUpPip,
    charSheet,
    describeNode,
    trackNodesFor,
    charSheetVm,
    refreshProgressUi,
    openLevelUpFor,
    openLevelUps,
  };
}
