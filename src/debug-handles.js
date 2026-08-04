// WHAT THE OUTSIDE CAN SEE.
//
// The two debug surfaces `startGame` published from inside itself (Q155):
// `window.__game`, the read-only window the e2e suite asserts through, and
// `window.__god`, the live-reference panel a human tunes the game with.
//
// They are a seam for a reason the other cuts did not have: this is the only
// block in `startGame` with NO caller inside the game. Nothing in main.js reads
// these objects; they exist purely so a spec or a console can ask the closure
// questions. That makes the dependency list long and the risk low - every entry
// is a READ of state somebody else owns, and the only two writes it performs
// (`party.cash`, the armed god pick) go back through the owner's own setter.
//
// Two rules the move had to respect, both recorded elsewhere as traps:
//
//   - `__game` must hand out GETTERS, never captured values. `sheet`, `player`,
//     `party`, `inCombat` and friends are reassigned bindings in main.js: a
//     value read at boot is the pre-picker null forever, and the suite would be
//     asserting against a character that no longer exists.
//   - the doors getter destructured `([key, d])`, which shadowed the deps bag
//     and made every other `d.` on the line a dead-zone read. It is `door` now.
//     That is the shadow trap main.js's own checker exists to catch.
export function createDebugHandles(d) {
  // Small read-only handle for tests and console poking.
  const game = {
    // Test hook: jump straight to the fully zoomed-out tactical view (setView
    // clamps to the rig's maxDist). The e2e suite used to do this with eight
    // mouse-wheel events per test, and every one forced a camera apply plus a
    // re-render - ~45 SECONDS per test under CI's software GL, in every single
    // test. One apply does the same job.
    zoomOut: () => d.controls.setView({ dist: 1e4 }),
    // The class registry, read-only. Exposed so a test can assert a created
    // character AGAINST its class headline rather than restating the numbers -
    // a test that hardcodes 6 breaks on every balance pass for no reason.
    get classes() { return d.CLASSES; },
    get playerTile() { return { x: d.player.x, z: d.player.z }; },
    // Layered levels (feasibility spike): which storey the leader is on, and
    // each storey's base height - what lets a spec project a mezzanine tile.
    get playerLayer() { return d.playerLayer; },
    get layerBaseY() { return d.floors ? d.floors.baseY : [0]; },
    // Is the leader mid-walk? The suite's honest alternative to sleeping: a
    // spec that wants "and then nothing happens" can poll for stillness rather
    // than guess a duration, which under software GL is reliably either too
    // short or wasteful on different runs.
    get playerMoving() { return !!d.player?.moving || d.legQueue.length > 0 || !!d.climbAnim; },
    // Sneak state for the suite: the mode, and whether any watcher currently
    // sees the leader's body - the same predicate the sweep runs.
    get sneak() { return d.sneakLayer.sneak ? { mode: d.sneakLayer.sneak.mode } : null; },
    get leaderSeen() {
      if (!d.player?.entity) return false;
      const p = d.player.entity.getPosition();
      return d.anyWatcherSees({ x: p.x, z: p.z });
    },
    get playerPos() {
      const p = d.player.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: d.player.x, z: d.player.z };
    },
    // Where the body you are STEERING is - the camera's follow target. Out of
    // a fight this is `playerPos`; in one it is the acting member, which is a
    // DIFFERENT body the moment a shared turn hands you a teammate. The camera
    // specs assert against this one, because asserting against `playerPos`
    // is what let the follow read the leader for so long: with a one-member
    // party the two agree, and the spec passed on a true negative.
    get steeredPos() {
      const a = d.steeredActor();
      const p = a.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: a.x, z: a.z };
    },
    // Where the camera actually sits, for tests that assert on the framing
    // (the tactical view collapses the horizontal offset to ~nothing).
    get cameraPos() {
      const c = d.controls.cameraEntity.getPosition();
      return { x: c.x, y: c.y, z: c.z };
    },
    // The point the rig is looking at, and whether a keyboard pan has
    // detached it from the follow target - the pair the camera specs assert
    // on (cameraPos moves with pitch/zoom too, which is noise to them).
    get cameraFocus() { return d.controls.focus; },
    get cameraFree() { return d.controls.panning; },
    // World point -> CSS-pixel screen point, so tests can click precise
    // ground points (mouse events arrive in CSS pixels).
    project(x, z) {
      const s = d.worldToScreenCss(d.controls.cameraEntity, x, 0, z);
      return { x: s.x, y: s.y };
    },
    // Project an arbitrary world point (y too), so tests can aim at a tall
    // mesh - a door panel, an enemy's body - not just the floor under it.
    project3(x, y, z) {
      const s = d.worldToScreenCss(d.controls.cameraEntity, x, y, z);
      return { x: s.x, y: s.y };
    },
    get inCombat() { return d.inCombat; },
    get gameOver() { return d.gameOver; },
    // Which floor is under you. The campaign transition is the one seam where
    // that changes, and a spec crossing it has no other way to tell level2 from
    // level1 once the page has reloaded into it.
    get levelId() { return d.activeLevelId; },
    get lastPath() { return d.lastPath; },
    get fadedWallCount() { return d.walls.filter((w) => w.faded).length; },
    get stats() {
      // gum/bleed now live in the status map; expose them as counts so the
      // debug/e2e reads (window.__game.stats.gum) keep working.
      return d.sheet
        ? { ...d.sheet, gum: d.statusLeft(d.sheet, 'gum'), bleed: d.statusLeft(d.sheet, 'bleed') }
        : null;
    },
    get playerSpeed() { return d.player.speed; },
    get burning() { return d.runtime.burningCount; },
    get smoking() { return d.runtime.smokingCount; },
    isSmoke: (x, z) => d.runtime.isSmoke(x, z),
    losClear: (ax, az, bx, bz) => d.hasLos({ x: ax, z: az }, { x: bx, z: bz }),
    get inventory() { return d.sheet ? [...d.sheet.inventory] : []; },
    get cash() { return d.party?.cash || 0; },
    get shopOpen() { return d.shopping.visible; },
    // A machine's remaining stock, by tile - the shop's answer to
    // containerLootAt, so a spec can assert a sold-out row without the DOM.
    shopStockAt: (x, z) => d.shopping.debug.stockAt(d.shopKey(x, z)),
    get looseItems() { return d.loot.debug.looseItems(); },
    get lootLabelCount() { return document.querySelectorAll('.loot-label').length; },
    containerLootAt: (...a) => d.loot.debug.containerLootAt(...a),
    get doors() { return [...d.grid.doors].map(([key, door]) => ({ key, open: door.open })); },
    surfaceAt: (x, z) => d.runtime.surfaceAt(x, z),
    // The TILE TYPE under a point, as the grid currently holds it. Terrain is
    // mutable - a printer that detonates becomes floor (grid.setType), a prop
    // that burns out is spent - and a spec has no other way to see that the
    // world actually changed rather than merely stopped burning.
    tileAt: (x, z) => d.grid.typeAt(x, z),
    // Terrain-only walkability - the full isWalkable would fold in whatever
    // body happens to be standing there. (The chunky fallen twins are SOLID
    // now - an object on its side, designer 2026-07-30 - so a topple spec
    // asserts the landing tile is NOT walkable; the flat ones, a downed
    // coat rack or partition, still are.)
    walkable: (x, z) => d.grid.terrainOpen(x, z),
    // The edge rule between two cells, for specs about partitions falling:
    // the tile grid alone cannot say whether the wall between two open tiles
    // is still standing.
    stepOpenAt: (x, z, nx, nz) => d.grid.stepOpen(x, z, nx, nz),
    // The hidden pools (TACTICS_PLAN M8) - the demolition specs' only honest
    // window: the tile keeps its type until the pool empties, so "the hit
    // landed" is invisible from the type grid alone.
    propHpAt: (x, z) => d.grid.propHpAt(x, z),
    edgeHpAt: (x, z, nx, nz) => d.grid.edgeHpBetween(x, z, nx, nz),
    // The leader's out-of-combat crouch, for the specs that seed a fight
    // with one (TACTICS_PLAN M6 OOC).
    get oocCrouch() { return d.oocCrouch; },
    // Is that door open? Doors sit on EDGES ('h:x,z' / 'v:x,z'), not tiles, so
    // `tileAt` can never answer this - and a door is the only piece of terrain
    // a fight can change, which is exactly what wants asserting.
    doorOpen: (key) => d.grid.doors.get(key)?.open ?? null,
    // Put a named coworker on an exact tile. A spec about what happens TO a
    // body standing somewhere (a bookcase landing on it, cover being measured
    // across it) otherwise has to wait for the AI to wander there, which makes
    // the spec a test of pathing instead of the thing it is about. pushTo is
    // the same glide a shove uses, so nothing about it is a special case.
    debugPlaceEnemy: (name, x, z) => {
      const en = d.enemies.find((e) => e.alive && e.def.name === name);
      if (!en) return false;
      en.clearPath();
      en.pushTo(x, z);
      return true;
    },
    // For the sneak specs: a wandering watcher's cone drifts, and a spec
    // about DETECTION must not flake on where an amble happened to point a
    // gaze. Maxing the existing timer stills them without a special case in
    // the wander brain itself.
    debugStillEnemies: () => {
      for (const en of d.enemies) en.wanderTimer = Infinity;
    },
    get enemies() {
      return d.enemies.map((e) => {
        const p = e.entity?.getPosition();
        // `reachable`: is there a walk-up route from the leader to a tile
        // beside them right now? Sealed-in coworkers (behind walls + a closed
        // door) are unreachable, so a click on them does nothing - the e2e
        // suite uses this to avoid wasting engage attempts on them.
        const reachable = e.alive
          && (d.playerReaches(e) || !!d.bestApproachPath(e.x, e.z));
        // `moving`: is this body part-way through a walk? An AI unit still
        // moving at the top of its beat is what stops its turn from ending
        // (combat.js's driver returns early on it), so it is the one field
        // that separates "the fight is slow" from "the fight is stuck".
        // `charmed` distinguishes "alive" from "hostile", which is exactly the
        // distinction a victory test has to make - so the suite can see it.
        return { name: e.def.name, x: e.x, z: e.z, px: p?.x, pz: p?.z, alive: e.alive, reachable,
          charmed: !!e.charmed,
          moving: !!e.moving, level: e.def.level || 1, hp: e.hp, maxHp: e.maxHp };
      });
    },
    get npcs() { return d.npcs.map((n) => ({ name: n.def.name, x: n.x, z: n.z })); },
    get summons() {
      return d.summons.filter((s) => s.sheet.hp > 0)
        .map((s) => ({
          name: s.actor.def.name, x: s.actor.x, z: s.actor.z, hp: s.sheet.hp,
          turnsLeft: s.actor.summonTurns,
        }));
    },
    get party() {
      return d.party ? d.party.members.map((m, i) => ({
        name: m.sheet.name, hp: m.sheet.hp, maxHp: m.sheet.maxHp,
        level: m.sheet.level, attrPoints: m.sheet.attrPoints || 0,
        classPoints: m.sheet.classPoints || 0, perks: [...(m.sheet.perks || [])],
        x: m.actor?.x, z: m.actor?.z, active: i === d.party.active,
      })) : [];
    },
    // Is the overhead tactical view up? (rail button / T key, for the e2e suite)
    get tactical() { return d.controls.tactical; },
    // Out-of-combat targeting + hover state, for the e2e suite.
    get armed() { return d.armedOoc; },
    get hoverKind() { return d.hover.hoverKind; },
    // The narration box's lines, newest last - for the e2e suite.
    get narration() { return d.ui.narrationLog(); },
    // What Examine would say about a tile, without opening a menu to find out.
    examineTile: (x, z) => d.examineTile(x, z),
    get ctrlHeld() { return d.hover.ctrlHeld; },
    // Is the hover body-glow actually LIT right now? (a tracked target, plus
    // either a held modifier or being in combat - the two halves of the gate)
    get hoverGlow() { return d.hover.glowing; },
    get cursor() { return d.canvasEl ? d.canvasEl.style.cursor : ''; },
    // Impaired sight (vision.js): how hard the aim is swaying, how far off the
    // mouse it currently is, and the verb the swaying reticles are wearing.
    get vision() { return d.vision.debug; },
    get dialogueOpen() { return d.dialogue.visible; },
  };

  // God mode (human-testing tweak panel; toggle with ` or F8). Unlike __game,
  // this hands out LIVE references and mutators so the panel can edit runtime
  // state in place - see god.js. It reflects over the same objects the game
  // owns; the action methods below are the few things the panel can't reach
  // without this closure (spawning into `enemies`, dropping via `loot`, etc.).
  const god = {
    get player() { return d.sheet; }, // the ACTIVE member's live sheet, or null pre-pick
    get playerActor() { return d.player; },
    get party() { return d.party; }, // live - the god panel reflects every member's sheet
    // The purse is party state (ECONOMY_PLAN #2), so it gets its own live
    // setter rather than hiding on a sheet card. Clamped at zero by addCash.
    get cash() { return d.party?.cash || 0; },
    setCash(n) {
      if (!d.party) return 0;
      d.party.cash = Math.max(0, Math.floor(Number(n) || 0));
      d.loot.refreshPanel(d.sheet);
      return d.party.cash;
    },
    switchTo(i) {
      // In combat this steers the open shared turn instead - refused unless
      // party.members[i] is holding the floor (INITIATIVE_PLAN). Returns
      // whether the steer was ACCEPTED, because refusal is the common case
      // (no shared turn this round) and a spec that cannot tell "it steered"
      // from "it declined" has to guess which one it just asserted about.
      if (!d.inCombat) { d.switchLeader(i); return true; }
      return !!d.combat?.steerMember(d.party?.members[i]);
    },
    reviveMember(i) {
      const m = d.party?.members[i];
      if (m && m.sheet.hp <= 0) d.helpUp(m);
      window.__combat?.refresh();
    },
    // Recruit a companion standing on this floor (the same path a dialogue
    // effect takes). Returns false when they aren't here or the roster's full.
    recruit(id) {
      const npc = d.npcs.find((n) => n instanceof d.CompanionActor && n.typeId === id);
      if (!npc || !d.canRecruit(npc)) return false;
      d.recruitCompanion(npc);
      return true;
    },
    get enemies() { return d.enemies; },
    get combat() { return window.__combat || null; }, // live only mid-fight
    app: d.app,
    get timeScale() { return d.app.timeScale; },
    set timeScale(v) { d.app.timeScale = v; },
    get inCombat() { return d.inCombat; },
    get gameOver() { return d.gameOver; },
    get burningCount() { return d.runtime.burningCount; },
    // Read an action's AP cost from the registry - so a test can assert
    // "affordable" without hardcoding a number that re-pricing would stale.
    actionAp: (id) => d.ACTIONS[id]?.ap ?? null,
    // Take a class-track node on a sheet, through the same function the
    // level-up screen calls - so a test exercises the real path rather than
    // hand-writing talent effects the game would never produce.
    spendClassPoint: (sheet, nodeId) => d.spendClassPoint(sheet, nodeId),
    // Talents are their own axis (TALENT_PLAN M1) and the picker that spends
    // talent points is M2, so this is how a test takes one through the real
    // grant path rather than hand-writing an effects bag.
    grantTalent: (sheet, talentId) => d.grantTalent(sheet, talentId),
    get doors() { return [...d.grid.doors].map(([key, door]) => ({ key, open: door.open })); },
    // Open or shut a door with no walk, no click and no AP. A door is the
    // only terrain a fight can change, so a test that needs one SHUT mid-fight
    // otherwise has to park the acting member on an exact tile and click an
    // edge midpoint that a frame's drift turns back into an ordinary step.
    // Same edit the player's own toggle makes (doors.setDoorOpen) - the price
    // and the gating are what this skips, not the rule.
    setDoor(key, open) {
      if (!d.grid.doors.has(key)) return false;
      d.doors.setDoorOpen(key, !!open);
      return true;
    },
    // Open a fight WHERE EVERYBODY STANDS, through the same entry the real
    // trigger uses (beginCombat) with the same engaged set (ENGAGE_RADIUS +
    // canTakePart) - only the walk-in is skipped. That walk is what a spec
    // cannot control: it ends wherever adjacency happens to fire, so the
    // geometry a positional test staged is gone by the time the fight opens.
    //
    // Deliberately NOT wired into the e2e enterCombat helper. That was tried
    // once as `startFightNow` and reverted for a good reason: opening from
    // where the player stands changes the geometry the existing specs are
    // written against (a touch-range verb like Detain arrives out of reach).
    // Opt-in per spec, so nothing already green re-interprets itself.
    fight(primaryName = null) {
      if (!d.sheet || d.inCombat || d.gameOver || !d.player.entity) return false;
      const live = d.enemies.filter((e) => e.alive);
      const primary = (primaryName && live.find((e) => e.def.name === primaryName))
        || live.find((e) => d.canTakePart(d.player, e))
        || live[0];
      if (!primary) return false;
      const engaged = live.filter((e) =>
        Math.max(Math.abs(e.x - d.player.x), Math.abs(e.z - d.player.z)) <= d.ENGAGE_RADIUS
        && d.canTakePart(d.player, e));
      if (!engaged.includes(primary)) engaged.push(primary);
      d.beginCombat({ engaged, primary });
      return true;
    },
    setDoorOpen(key, open) {
      if (!d.grid.doors.has(key)) return;
      d.grid.setDoorOpen(key, open);
      d.scene.refreshDoor(key);
      for (const e of d.enemies) e.clearPath(); // their routes may have changed
    },
    // Resolves an ENEMY_TYPES id or a class archetype (e.g. 'employee'), so a
    // tester can drop class-based units to feel out balance.
    spawnEnemy(typeId, x, z) {
      const base = d.ENEMY_TYPES[typeId] || d.CLASSES[typeId];
      if (!base) return null;
      const def = d.scaleEnemy(base, d.effectiveLevel(base, d.floorDepth)); // match the floor
      const en = new d.EnemyActor(x, z, typeId, def);
      d.enemies.push(en);
      d.placeModel(d.app, `assets/characters/${def.model}.glb`, x, z, {
        lift: d.lift, rotY: -90, animate: true,
        onReady: (e) => { d.dressUp(e, en, def.look, def.model); d.picking.register(e, 'enemy', en); },
      });
      return en;
    },
    // Drop a player-team summon beside the active member (combat only) - the
    // console-side twin of the HR class's Post the Role, for tuning.
    // `lifetimeTurns` null = permanent, a number = turns of assignment before
    // the employee files out (the tuning knob milestone 4 left open).
    summonAlly(archetypeId = 'employee', n = 1, lifetimeTurns = null) {
      return window.__combat ? window.__combat.summonAlly(archetypeId, n, lifetimeTurns) : 0;
    },
    giveItem(id) {
      if (!d.sheet) return;
      d.sheet.inventory.push(id);
      d.loot.refreshPanel(d.sheet);
      d.paintHud(d.sheet);
    },
    dropItem(id, x, z) { d.loot.dropAt(x, z, id); },
    // Clean out a merchant in one step (ECONOMY_PLAN): the same end state as
    // buying every row, for looking at the sold-out presentation without
    // spending nine clicks getting there.
    emptyShop(x, z) { d.shopping.emptyStock(d.shopKey(x, z)); },
    teleport(x, z) {
      if (!d.player.entity) return;
      const p = d.player.entity.getPosition();
      d.player.clearPath();
      d.player.entity.setPosition(x, p.y, z);
      d.player.x = Math.round(x);
      d.player.z = Math.round(z);
    },
    refreshHud() { if (d.sheet) { d.paintHud(d.sheet); d.loot.refreshPanel(d.sheet); } },
    // Click-to-place: the panel arms a callback, the next left-click on the
    // ground (handled in onLeftClickTile) fires it with the picked tile/point.
    armPick(cb) { d.setPendingGodPick(cb); },
    get picking() { return !!d.pendingGodPick; },
    // Step the fire/smoke lifecycle one turn (what a combat round does) - a
    // deterministic handle for the god panel and tests, independent of the
    // out-of-combat real-time clock.
    advanceFireTurn() { d.runtime.advanceTurn(); },
  };

  return { game, god };
}
