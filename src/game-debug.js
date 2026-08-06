// The read-mostly browser/test view of a running floor. Keep projections here
// so startGame owns game state without also owning a second, sprawling public
// representation of it.

function dataSnapshot(value) {
  if (Array.isArray(value)) return value.map(dataSnapshot);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, dataSnapshot(child)]));
}

export function createGameDebug(d) {
  return {
    zoomOut: () => d.controls.setView({ dist: 1e4 }),
    // A fresh data snapshot: callers may inspect or even edit it without
    // changing the registry that future sheets and enemies are built from.
    get classes() { return dataSnapshot(d.classes); },
    get playerTile() { return { x: d.player.x, z: d.player.z }; },
    get playerLayer() { return d.playerLayer; },
    get layerBaseY() { return d.floors ? d.floors.baseY : [0]; },
    get playerMoving() { return !!d.player?.moving || d.legQueue.length > 0 || !!d.climbAnim; },
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
    get steeredPos() {
      const actor = d.steeredActor();
      const p = actor.entity?.getPosition();
      return p ? { x: p.x, z: p.z } : { x: actor.x, z: actor.z };
    },
    get cameraPos() {
      const c = d.controls.cameraEntity.getPosition();
      return { x: c.x, y: c.y, z: c.z };
    },
    get cameraFocus() { return d.controls.focus; },
    get cameraFree() { return d.controls.panning; },
    project(x, z) {
      const p = d.worldToScreenCss(d.controls.cameraEntity, x, 0, z);
      return { x: p.x, y: p.y };
    },
    project3(x, y, z) {
      const p = d.worldToScreenCss(d.controls.cameraEntity, x, y, z);
      return { x: p.x, y: p.y };
    },
    get inCombat() { return d.inCombat; },
    get gameOver() { return d.gameOver; },
    get levelId() { return d.activeLevelId; },
    get lastPath() { return d.lastPath; },
    get fadedWallCount() { return d.walls.filter((wall) => wall.faded).length; },
    get stats() {
      return d.sheet ? {
        ...d.sheet,
        gum: d.statusLeft(d.sheet, 'gum'),
        bleed: d.statusLeft(d.sheet, 'bleed'),
      } : null;
    },
    get playerSpeed() { return d.player.speed; },
    get burning() { return d.runtime.burningCount; },
    get smoking() { return d.runtime.smokingCount; },
    isSmoke: (x, z) => d.runtime.isSmoke(x, z),
    losClear: (ax, az, bx, bz) => d.hasLos({ x: ax, z: az }, { x: bx, z: bz }),
    get inventory() { return d.sheet ? [...d.sheet.inventory] : []; },
    get cash() { return d.party?.cash || 0; },
    get shopOpen() { return d.shopping.visible; },
    shopStockAt: (x, z) => d.shopping.debug.stockAt(d.shopKey(x, z)),
    get looseItems() { return d.loot.debug.looseItems(); },
    get lootLabelCount() { return d.document.querySelectorAll('.loot-label').length; },
    containerLootAt: (...args) => d.loot.debug.containerLootAt(...args),
    get doors() { return [...d.grid.doors].map(([key, door]) => ({ key, open: door.open })); },
    surfaceAt: (x, z) => d.runtime.surfaceAt(x, z),
    tileAt: (x, z) => d.grid.typeAt(x, z),
    walkable: (x, z) => d.grid.terrainOpen(x, z),
    stepOpenAt: (x, z, nx, nz) => d.grid.stepOpen(x, z, nx, nz),
    propHpAt: (x, z) => d.grid.propHpAt(x, z),
    edgeHpAt: (x, z, nx, nz) => d.grid.edgeHpBetween(x, z, nx, nz),
    get oocCrouch() { return d.oocCrouch; },
    doorOpen: (key) => d.grid.doors.get(key)?.open ?? null,
    debugPlaceEnemy(name, x, z) {
      const enemy = d.enemies.find((candidate) => candidate.alive && candidate.def.name === name);
      if (!enemy) return false;
      enemy.clearPath();
      enemy.pushTo(x, z);
      return true;
    },
    debugStillEnemies() {
      for (const enemy of d.enemies) enemy.wanderTimer = Infinity;
    },
    get enemies() {
      return d.enemies.map((enemy) => {
        const p = enemy.entity?.getPosition();
        const reachable = enemy.alive
          && (d.playerReaches(enemy) || !!d.bestApproachPath(enemy.x, enemy.z));
        return {
          name: enemy.def.name,
          x: enemy.x,
          z: enemy.z,
          px: p?.x,
          pz: p?.z,
          alive: enemy.alive,
          reachable,
          charmed: !!enemy.charmed,
          moving: !!enemy.moving,
          level: enemy.def.level || 1,
          hp: enemy.hp,
          maxHp: enemy.maxHp,
        };
      });
    },
    get npcs() { return d.npcs.map((npc) => ({ name: npc.def.name, x: npc.x, z: npc.z })); },
    get summons() {
      return d.summons.filter((summon) => summon.sheet.hp > 0)
        .map((summon) => ({
          name: summon.actor.def.name,
          x: summon.actor.x,
          z: summon.actor.z,
          hp: summon.sheet.hp,
          turnsLeft: summon.actor.summonTurns,
        }));
    },
    get party() {
      return d.party ? d.party.members.map((member, i) => ({
        name: member.sheet.name,
        hp: member.sheet.hp,
        maxHp: member.sheet.maxHp,
        level: member.sheet.level,
        attrPoints: member.sheet.attrPoints || 0,
        classPoints: member.sheet.classPoints || 0,
        perks: [...(member.sheet.perks || [])],
        x: member.actor?.x,
        z: member.actor?.z,
        active: i === d.party.active,
      })) : [];
    },
    get tactical() { return d.controls.tactical; },
    get armed() { return d.armedOoc; },
    get aimPaint() { return d.aimPaint.debug; },
    get hoverKind() { return d.hover.hoverKind; },
    get narration() { return d.ui.narrationLog(); },
    examineTile: (x, z) => d.examineTile(x, z),
    get ctrlHeld() { return d.hover.ctrlHeld; },
    get hoverGlow() { return d.hover.glowing; },
    get cursor() { return d.canvasEl ? d.canvasEl.style.cursor : ''; },
    get vision() { return d.vision.debug; },
    get dialogueOpen() { return d.dialogue.visible; },
  };
}
