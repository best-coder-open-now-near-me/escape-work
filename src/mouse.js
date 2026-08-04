// WHAT A CLICK MEANS.
//
// The mouse half of the input layer, and the counterpart to keyboard.js: the
// left-click verb dispatch, the hover affordances, and the right-click menu.
// Four hundred lines of `startGame` were this one object literal, wedged inside
// a `createControls(...)` call - which is why the ladder inside it (a click
// resolves to a BODY first, then a door, then a stair, then the floor) could
// never be read as the ordered list of decisions it actually is.
//
// It returns the handler bag rather than taking `controls` over: the rig - pan,
// zoom, pitch, the tactical view - is controls.js's job, and only the MEANING of
// a click is this file's. main.js spreads the result into the same call it
// always made, so the seam costs the call site one line.
//
// `oocAim` and `pendingGodPick` go back through named setters (the aim point
// feeds the drop-ring affordance; the god panel arms its own pick), and
// `hover`/`controls` arrive as getters because both are declared BELOW the call
// that needs them.
export function createMouse(d) {
  return {
    onAnyLeftPress: () => d.ui.hideMenu(),
    // However the view is left - the button, T, a pitch drag, a raw setView -
    // the rail button repaints, so its lit state can never outlive the view.
    onTacticalChange: () => d.tacticalBtn?.refresh(),
    onLeftClickTile: (tile, point, sx, sy) => {
      // God-mode click-to-place (spawn/drop/teleport) consumes the click before
      // any normal handling, reusing the game's own ground raycast.
      if (d.pendingGodPick) {
        const cb = d.pendingGodPick;
        d.setPendingGodPick(null);
        cb(tile, point);
        return;
      }
      if (!d.sheet || d.gameOver) return;
      // In combat a click resolves in the same order the hover affordances do:
      // the body under the pixel, then a body near the ground point, then the
      // tile - so what the crosshair and the to-hit readout said is what the
      // click does.
      if (d.inCombat) {
        // Initiative: you control whoever's turn it is - a party member or a
        // summon you conjured. combat.actingActor is that body (party.active
        // can't point at a summon, which lives outside the roster). Clicks
        // target enemies or drive that unit; no switching (each acts on its
        // own turn).
        const actingActor = d.combat?.actingActor || d.party?.members[d.party.active]?.actor || d.player;
        // The acting member's OWN tile wins first: a self-cast (purge on
        // yourself) or a shuffle-in-place must not be stolen by an adjacent
        // enemy's tall body mesh overlapping the click.
        if (tile && actingActor && tile.x === actingActor.x && tile.z === actingActor.z) {
          d.combat?.handleTileClick(tile, point);
          return;
        }
        // A coworker's body under the cursor is a target (rings mark bodies;
        // the ground fallback behind a tall mesh is a mis-walk that burns AP).
        const bodyHit = d.picking.pick(d.controls.cameraEntity, sx, sy);
        // A FRIENDLY body, while a friendly verb is armed (POWERS_PLAN M1).
        // Gated on `armedIsFriendly` so a click on a teammate means nothing
        // different from before unless you are actually aiming a buff -
        // ungated, it would eat the clicks that walk you past your own party.
        if (d.combat?.armedIsFriendly
          && (bodyHit?.kind === 'party' || bodyHit?.kind === 'summon')) {
          const ally = d.combat.allyAtPoint(point)
            || (bodyHit.ref && d.combat.allyAtPoint({ x: bodyHit.ref.x, z: bodyHit.ref.z }));
          if (ally && d.combat.handleAllyClick(ally)) return;
        }
        // A teammate's body with NO friendly verb armed: under a shared turn
        // this grabs the wheel (INITIATIVE_PLAN) - the same body click that
        // switches the leader out of combat. Steering only ever succeeds on a
        // member holding the open turn, so outside one the click falls
        // through to the mis-walk it always was.
        if ((bodyHit?.kind === 'party' || bodyHit?.kind === 'summon')
          && d.combat?.steerMember(bodyHit.ref)) return;
        if (bodyHit?.kind === 'enemy' && bodyHit.ref.alive) {
          d.combat?.handleEnemyClick(bodyHit.ref);
          return;
        }
        // Ground fallback: the same near-a-body test the hover affordances
        // run (combat.enemyAtPoint), so a click can't route into a walk on a
        // point where the crosshair was promising a swing. An exact-tile
        // match here was a third authority on "is this a coworker?" - it said
        // no on the outer band of a body the cursor said yes to.
        const near = point && d.combat?.enemyAtPoint(point);
        if (near) { d.combat?.handleEnemyClick(near); return; }
        // A door, before the tile fallback - otherwise the click walks you at
        // the door instead of working it. toggleDoor owns the rules from here:
        // it refuses with a reason when you are not beside it, and bills the
        // AP when you are.
        const dk = d.combatDoorAt(bodyHit, point);
        if (dk) { d.toggleDoor(dk); return; }
        if (!tile) return;
        d.combat?.handleTileClick(tile, point);
        return;
      }
      if (d.modalOpen()) return; // talking: clicks belong to the panel
      // Layered storeys: a click means what the eye sees - resolve it against
      // the visible storeys top-down. A stair run routes a climb, another
      // storey routes a cross-storey walk, and a same-storey hit simply
      // becomes the tile/point every verb below already reads.
      if (d.floors) {
        if (d.climbAnim) return; // the flight finishes before the next order
        // The flight's own boxes win the click before any ground plane: a
        // pixel on the risers would otherwise resolve to whatever tile the
        // ray reaches BEHIND the raised steps.
        const stairHit = d.picking.pick(d.controls.cameraEntity, sx, sy);
        if (stairHit?.kind === 'stair') { d.routeViaStair(stairHit.ref); return; }
        const res = d.layeredPick(sx, sy);
        if (!res) return;
        if (res.stair) { d.routeViaStair(res.stair); return; }
        if (res.layer !== d.playerLayer) { d.walkToLayer(res.tile, res.point, res.layer); return; }
        tile = res.tile;
        point = res.point;
      }
      // An armed SUMMON aims at the floor, so while it is armed the world is a
      // placement grid and nothing else: the click posts the role where you
      // pointed rather than walking there, rummaging the desk behind the point,
      // or opening a fight with whoever is standing in the way. A refused spot
      // says why and stays armed (postSummonAt), so the next click can just be
      // a better one.
      if (d.armedOoc && d.ACTIONS[d.armedOoc].type === 'summon') {
        if (tile) d.postSummonAt(d.armedOoc, tile.x, tile.z);
        return;
      }
      // A CONE is aimed at a DIRECTION, so the ground is its natural target -
      // and the ground branch only ever handled summons, so aiming Bulk Mail at
      // the floor silently walked you there instead. It opens the fight on
      // whoever the wedge actually catches, which is the same rule the preview
      // just drew - and an EMPTY wedge fires all the same (designer,
      // 2026-07-31): it needed a coworker in the way before, which made the
      // one cone whose whole point is the paper behind it the one attack you
      // could not fire at the floor.
      if (d.armedOoc && d.ACTIONS[d.armedOoc].cone && point) {
        const a = d.ACTIONS[d.armedOoc];
        // From the BODY, like the preview and the in-combat wedge - one
        // geometry for the whole click (DEGRID M5).
        const test = d.coneFrom(a, d.leadBody(), point.x, point.z);
        if (!test) { d.ui.say('Aim somewhere.'); return; } // the cursor is on you
        const caught = d.coneCatches(test);
        if (caught.length) {
          // The nearest one is the primary; the rest join through the engage
          // radius exactly as they would for any other opener.
          caught.sort((p, q) => d.cheb(d.player, p) - d.cheb(d.player, q));
          d.engageWithAction(caught[0], d.armedOoc, point);
          return;
        }
        d.fireOocCone(a, test, point.x, point.z);
        return;
      }
      // An armed SHOVE aimed at the office itself works out here too
      // (designer, 2026-07-30): furniture and partitions topple with no
      // fight on. Ahead of the entity pick, or the prop mesh under the click
      // would open its rummage panel instead of taking the shoulder.
      if (d.armedOoc && d.ACTIONS[d.armedOoc].type === 'shove' && tile && !d.enemyAt(tile.x, tile.z)
        && d.oocShoveAt(tile)) return;
      // An armed TAKE COVER: crouch before anyone has noticed you.
      if (d.armedOoc && d.ACTIONS[d.armedOoc].type === 'cover' && tile) {
        d.oocTakeCoverAt(tile, point);
        return;
      }
      // Out of combat, the interactable ENTITY under the cursor wins over the
      // floor tile behind it - what finally makes a click on the tall door
      // mesh (or a standing enemy) land on the thing you aimed at.
      const hit = d.picking.pick(d.controls.cameraEntity, sx, sy);
      if (hit && d.dispatchHit(hit)) return;
      if (!tile) return;
      // Ground fallback - also catches flat targets the pick ray skims over: a
      // door edge clicked on the floor, corpses, dropped items.
      const en = d.enemyAt(tile.x, tile.z);
      const npc = d.npcAt(tile.x, tile.z);
      const corpse = d.loot.corpseAt(tile.x, tile.z);
      const doorKey = d.doorNearPoint(point);
      if (en) d.attackOrConfront(en);
      else if (npc) d.approachAndDo(npc.x, npc.z, () => d.dialogue.open(npc));
      else if (doorKey) d.approachDoor(doorKey);
      else if (d.grid.defAt(tile.x, tile.z).loot) {
        d.approachAndDo(tile.x, tile.z, () => d.loot.lootContainer(tile.x, tile.z));
      } else if (corpse) {
        d.approachAndDo(corpse.x, corpse.z, () => d.loot.lootBody(corpse));
      } else if (d.loot.looseAt(tile.x, tile.z).length) {
        d.approachAndDo(tile.x, tile.z, () => d.loot.pickUpAt(tile.x, tile.z));
      } else d.moveTo(tile, point);
    },
    onHover: (point, sx, sy) => {
      if (d.inCombat && d.combat) {
        const hit = d.picking.pick(d.controls.cameraEntity, sx, sy);
        // The acting body's OWN tile is the click's first authority (see
        // onLeftClickTile): a self-cast or a shuffle in place must not be
        // stolen by an adjacent coworker's tall mesh overlapping the pixel.
        // The hover had no such rule, so on those pixels the crosshair and
        // the to-hit readout promised a swing that the click turned into an
        // in-place shuffle. Same test, same rounding as `screenToTile`, so
        // the two affordances answer together.
        const acting = d.combat.actingActor || d.party?.members[d.party.active]?.actor || d.player;
        const onOwnTile = !!acting && !!point
          && Math.round(point.x) === acting.x && Math.round(point.z) === acting.z;
        // A coworker under the cursor is a TARGET, armed or not - a bare click
        // swings the basic attack (combat.js), so the cursor has to say so.
        // combat.handleHover resolves WHO that is (this body pick first, the
        // ground point as fallback) and WHETHER a click would swing right now
        // (the click's own gate: your turn, standing still) - and the
        // crosshair keys off that one answer. Reading the raw pick here showed
        // a crosshair mid-walk and on AI turns, promising a swing while the
        // to-hit readout and the click itself refused.
        const picked = !onOwnTile && hit?.kind === 'enemy' && hit.ref.alive ? hit.ref : null;
        // The hovered door, resolved ONCE with the click's own predicate
        // (combatDoorAt) and handed to combat alongside the hover - the
        // pointer cursor and the threshold ring read this same answer, so
        // the two affordances light together and die together.
        const doorKey = d.combatDoorAt(hit, point);
        // handleHover still runs with the real point - a cone, a zone and a
        // summon drop all aim off it, and the shuffle's own move preview is
        // priced there too. It is `hoverFoe` that stands down, which takes
        // the crosshair, the glow, the ring and the readout together.
        const foe = d.combat.handleHover(point, sx, sy, picked,
          doorKey ? d.doorMidpoint(doorKey) : null, onOwnTile);
        // A coworker wins the cursor; failing that, a door you could work says
        // so with the same pointer it uses out of combat. The click reads the
        // very same predicate, so the two cannot disagree.
        d.hover.setCursor(foe ? 'crosshair' : (doorKey ? 'pointer' : null));
        // Hovering a character glows their BODY and names them in the banner -
        // the DOS2 read, and the same one you already get out of combat. This
        // used to be held behind Ctrl, which meant the half of the game where
        // you aim at people was the half that wouldn't show you who you were
        // aiming at. Ctrl still adds the ground rings under EVERY character
        // (drawCharacterRings) - that's the at-a-glance read of the whole
        // board, which is a different question from "what is under my cursor".
        // A foe the hover resolved through the GROUND fallback (the pick ray
        // missed the mesh, but the point is on their body) counts as hovered
        // too: the crosshair is claiming you're aiming at them, so the glow
        // and the banner have to name the same coworker.
        const charHit = foe && !picked ? { kind: 'enemy', ref: foe, entity: foe.entity } : hit;
        const character = charHit && (charHit.kind === 'party' || charHit.kind === 'npc'
          || (charHit.kind === 'enemy' && charHit.ref.alive));
        d.hover.showCharacter(character ? charHit : null, point);
        return;
      }
      if (!d.sheet || d.gameOver || d.modalOpen()) { d.hover.clear(); d.setOocAim(null); return; }
      // Layered: the hover point follows the same top-down storey pick as the
      // click, so the banner and the drop rings describe what the eye is on.
      if (d.floors) {
        const res = d.layeredPick(sx, sy);
        if (res) point = res.point;
      }
      // The ground point is remembered, not just consumed: an armed summon
      // draws its drop rings every frame (immediate-mode lines last one), and
      // hover events only arrive when the mouse actually moves.
      d.setOocAim(point);
      d.hover.hover(point, sx, sy);
    },
    // The cursor left the world for the DOM UI: drop the world hover rather
    // than leaving the last-hovered body glowing and named behind the panel
    // the player is now using.
    onHoverLeave: () => {
      d.hover.clear();
      d.setOocAim(null); // no cursor on the floor, no drop rings
      if (d.inCombat && d.combat) d.combat.handleHover(null, 0, 0);
    },
    onRightClickTile: (tile, sx, sy, point) => {
      if (!d.sheet || d.gameOver) return;
      // In combat, right-click is first the universal "back out": it lowers an
      // armed action or a pending confirm. Left-click never cancels (it reports
      // an invalid target), so aiming survives a near-miss.
      //
      // With nothing to back out of, it opens the context menu instead - the
      // Examine verb had no way in during a fight, which is the half of the
      // game where you most want to know what you're looking at. Only Examine:
      // every other verb in here spends a turn, and those belong on the action
      // bar where their AP cost is visible.
      if (d.inCombat) {
        if (d.combat?.cancelArmed()) return;
        const chit = d.picking.pick(d.controls.cameraEntity, sx, sy);
        const items = [];
        // A door you are standing beside. This is a turn-spending verb, so it
        // wears its price on the label - which is the same rule that keeps
        // everything else out of this menu and on the bar, honoured rather
        // than broken. Doors have no bar slot: they are terrain, not kit.
        const dk = chit?.kind === 'door' ? chit.ref : (point ? d.doorNearPoint(point) : null);
        if (dk && d.atDoor(dk, d.combat?.actingActor)) {
          const isOpen = d.grid.doors.get(dk)?.open;
          items.push({
            label: `${isOpen ? 'Pull the door shut' : 'Open the door'} - ${d.COMBAT_DOOR_AP} AP`,
            action: () => d.toggleDoor(dk),
          });
        }
        // A teammate holding the open shared turn gets a steering item - the
        // in-combat sibling of the out-of-combat "Switch to" below.
        const wheel = (chit?.kind === 'party' || chit?.kind === 'summon')
          ? d.combat?.canSteer(chit.ref) : null;
        if (wheel) items.push({ label: `Steer ${wheel}`, action: () => d.combat.steerMember(chit.ref) });
        const text = d.examineAt(chit, tile, point);
        if (text) items.push({ label: 'Examine', action: () => d.ui.say(text) });
        if (items.length) d.ui.showMenu(sx, sy, items);
        return;
      }
      if (d.modalOpen()) return;
      // Layered: the menu describes the storey you are ON - a right-click
      // aimed at another storey stays silent rather than offering verbs the
      // walk rules would then refuse.
      if (d.floors) {
        if (d.climbAnim) return;
        const res = d.layeredPick(sx, sy);
        if (!res || res.layer !== d.playerLayer) return;
        tile = res.tile;
        point = res.point;
      }
      const hit = d.picking.pick(d.controls.cameraEntity, sx, sy);
      if (hit && hit.kind === 'npc') {
        d.ui.showMenu(sx, sy, [
          { label: `Talk to ${hit.ref.def.name}`, action: () => d.approachAndDo(hit.ref.x, hit.ref.z, () => d.dialogue.open(hit.ref)) },
          { label: 'Examine', action: () => d.ui.say(d.examineAt(hit, tile, point)) },
        ]);
        return;
      }
      if (hit && hit.kind === 'party') {
        const m = d.memberOf(hit.ref);
        // Your own healthy body falls through to the ordinary tile menu.
        if (m && (m !== d.partyLeader(d.party) || m.sheet.hp <= 0)) {
          const items = [];
          if (m.sheet.hp <= 0) {
            // The label states the cost, because a hand up is no longer free
            // and finding that out by walking over is a wasted turn.
            const kit = d.reviveIndex((d.inCombat && d.combat ? d.combat.actingSheet : d.sheet)?.inventory);
            items.push({
              label: kit === -1
                ? `Help ${m.sheet.name} up (need a first-aid kit)`
                : `Help ${m.sheet.name} up (${d.ITEMS[(d.inCombat && d.combat ? d.combat.actingSheet : d.sheet).inventory[kit]].name})`,
              action: () => d.approachAndDo(hit.ref.x, hit.ref.z, () => d.helpUp(m)),
            });
          } else {
            if (hit.ref.def?.dialogue || hit.ref.def?.recruitedDialogue) {
              items.push({ label: `Talk to ${m.sheet.name}`, action: () => d.approachAndDo(hit.ref.x, hit.ref.z, () => d.dialogue.open(hit.ref)) });
            }
            const i = d.party.members.indexOf(m);
            if (i !== d.party.active) items.push({ label: `Switch to ${m.sheet.name}`, action: () => d.switchLeader(i) });
          }
          items.push({ label: 'Examine', action: () => d.ui.say(d.examineAt(hit, tile, point)) });
          d.ui.showMenu(sx, sy, items);
          return;
        }
      }
      if (!tile) return;
      const doorKey = (hit && hit.kind === 'door') ? hit.ref : d.doorNearPoint(point);
      if (doorKey) {
        const open = d.grid.doors.get(doorKey).open;
        d.ui.showMenu(sx, sy, [
          { label: open ? 'Close the door' : 'Open the door', action: () => d.approachDoor(doorKey) },
          { label: 'Examine', action: () => d.ui.say(d.doorExamine(open)) },
        ]);
        return;
      }
      const en = (hit && hit.kind === 'enemy' && hit.ref.alive) ? hit.ref : d.enemyAt(tile.x, tile.z);
      if (en) {
        d.ui.showMenu(sx, sy, [
          { label: `Confront ${en.def.name}`, action: () => d.confront(en) },
          { label: 'Avoid eye contact', action: () => d.ui.say('You study your shoes intently.') },
          { label: 'Examine', action: () => d.ui.say(en.def.examine || 'A coworker, in the way.') },
        ]);
      } else if (d.isWalkable(tile.x, tile.z)) {
        const surfId = d.runtime.surfaceAt(tile.x, tile.z);
        const items = [
          { label: 'Walk here', action: () => d.moveTo(tile, point) },
          { label: 'Examine', action: () => d.ui.say(d.examineTile(tile.x, tile.z)) },
        ];
        const here = d.loot.looseAt(tile.x, tile.z);
        if (here.length) {
          items.unshift({
            label: `Pick up ${d.loot.itemName(here[0].id)}${here.length > 1 ? ` (+${here.length - 1})` : ''}`,
            action: () => d.approachAndDo(tile.x, tile.z, () => d.loot.pickUpAt(tile.x, tile.z)),
          });
        }
        const corpse = d.loot.corpseAt(tile.x, tile.z);
        if (corpse) {
          items.unshift({
            label: `Loot ${corpse.def.name}'s body`,
            action: () => d.approachAndDo(corpse.x, corpse.z, () => d.loot.lootBody(corpse)),
          });
        }
        // A lighter (Smoker) or a book of matches turns a flammable surface
        // into an option.
        if (d.canIgnite() && surfId && d.SURFACES[surfId].flammable && !d.runtime.isBurning(tile.x, tile.z)) {
          items.unshift({
            label: d.igniteVerb(),
            action: () => d.approachAndDo(tile.x, tile.z, () => d.igniteAt(tile.x, tile.z)),
          });
        }
        d.ui.showMenu(sx, sy, items);
      } else if (d.grid.defAt(tile.x, tile.z).ignitable) {
        const items = [{ label: 'Examine', action: () => d.ui.say(d.examineTile(tile.x, tile.z)) }];
        if (d.canIgnite() && d.runtime.ignitable(tile.x, tile.z)) {
          items.unshift({
            label: d.igniteVerb(),
            action: () => d.approachAndDo(tile.x, tile.z, () => d.igniteAt(tile.x, tile.z)),
          });
        }
        items.unshift({
          label: 'Rummage',
          action: () => d.approachAndDo(tile.x, tile.z, () => d.loot.lootContainer(tile.x, tile.z)),
        });
        d.ui.showMenu(sx, sy, items);
      } else if (d.grid.defAt(tile.x, tile.z).explosive) {
        d.ui.showMenu(sx, sy, [
          { label: 'Rummage', action: () => d.approachAndDo(tile.x, tile.z, () => d.loot.lootContainer(tile.x, tile.z)) },
          { label: 'Examine', action: () => d.ui.say(d.examineTile(tile.x, tile.z)) },
        ]);
      } else {
        const def = d.grid.defAt(tile.x, tile.z);
        const items = [{ label: 'Examine', action: () => d.ui.say(d.examineTile(tile.x, tile.z)) }];
        if (def.shop) {
          items.unshift({
            label: `Buy from the ${def.label}`,
            action: () => d.approachAndDo(tile.x, tile.z, () => d.openShopAt(tile.x, tile.z)),
          });
        }
        if (def.loot && !def.shop) {
          items.unshift({
            label: 'Rummage',
            action: () => d.approachAndDo(tile.x, tile.z, () => d.loot.lootContainer(tile.x, tile.z)),
          });
        }
        d.ui.showMenu(sx, sy, items);
      }
    },
  };
}
