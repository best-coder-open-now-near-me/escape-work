// The deliberately mutable API behind the god-mode panel. Unlike game-debug,
// this returns live sheets/actors on purpose; the important boundary is that
// every mutation requiring an invariant is a named method here.
export function createGodDebug(d) {
  return {
    get player() { return d.sheet; },
    get playerActor() { return d.player; },
    get party() { return d.party; },
    get cash() { return d.party?.cash || 0; },
    setCash(n) {
      if (!d.party) return 0;
      d.party.cash = Math.max(0, Math.floor(Number(n) || 0));
      d.loot.refreshPanel(d.sheet);
      return d.party.cash;
    },
    switchTo(i) {
      if (!d.inCombat) {
        d.switchLeader(i);
        return true;
      }
      return !!d.combat?.steerMember(d.party?.members[i]);
    },
    reviveMember(i) {
      const member = d.party?.members[i];
      if (member && member.sheet.hp <= 0) d.helpUp(member);
      d.combat?.refresh();
    },
    recruit(id) {
      const npc = d.npcs.find((candidate) => candidate instanceof d.CompanionActor
        && candidate.typeId === id);
      if (!npc || !d.canRecruit(npc)) return false;
      d.recruitCompanion(npc);
      return true;
    },
    get enemies() { return d.enemies; },
    get combat() { return d.combat; },
    app: d.app,
    get timeScale() { return d.app.timeScale; },
    set timeScale(v) { d.app.timeScale = v; },
    get inCombat() { return d.inCombat; },
    get gameOver() { return d.gameOver; },
    get burningCount() { return d.runtime.burningCount; },
    actionAp: (id) => d.actions[id]?.ap ?? null,
    spendClassPoint: (...args) => d.spendClassPoint(...args),
    grantTalent: (...args) => d.grantTalent(...args),
    get doors() { return [...d.grid.doors].map(([key, door]) => ({ key, open: door.open })); },
    setDoor(key, open) {
      if (!d.grid.doors.has(key)) return false;
      d.doors.setDoorOpen(key, !!open);
      return true;
    },
    fight(primaryName = null) {
      if (!d.sheet || d.inCombat || d.gameOver || !d.player.entity) return false;
      const live = d.enemies.filter((enemy) => enemy.alive);
      const primary = (primaryName && live.find((enemy) => enemy.def.name === primaryName))
        || live.find((enemy) => d.canTakePart(d.player, enemy))
        || live[0];
      if (!primary) return false;
      const engaged = d.engagedAround(
        live,
        d.player,
        d.engageRadius,
        d.canTakePart,
        primary,
      );
      d.beginCombat({ engaged, primary });
      return true;
    },
    setDoorOpen(key, open) {
      if (!d.grid.doors.has(key)) return;
      d.grid.setDoorOpen(key, open);
      d.scene.refreshDoor(key);
      for (const enemy of d.enemies) enemy.clearPath();
    },
    spawnEnemy(typeId, x, z, level = null) {
      const base = d.enemyTypes[typeId] || d.classes[typeId];
      if (!base) return null;
      const def = d.scaleEnemy(base, level ?? (base.level || 1));
      const enemy = new d.EnemyActor(x, z, typeId, def);
      d.enemies.push(enemy);
      d.placeModel(d.app, `assets/characters/${def.model}.glb`, x, z, {
        lift: d.lift,
        rotY: -90,
        animate: true,
        onReady: (entity) => {
          d.dressUp(entity, enemy, def.look, def.model);
          d.picking.register(entity, 'enemy', enemy);
        },
      });
      return enemy;
    },
    summonAlly(archetypeId = 'employee', n = 1, lifetimeTurns = null) {
      return d.combat?.summonAlly(archetypeId, n, lifetimeTurns) || 0;
    },
    giveItem(id) {
      if (!d.sheet) return;
      d.sheet.inventory.push(id);
      d.loot.refreshPanel(d.sheet);
      d.paintHud(d.sheet);
    },
    dropItem: (id, x, z) => d.loot.dropAt(x, z, id),
    emptyShop: (x, z) => d.shopping.emptyStock(d.shopKey(x, z)),
    teleport(x, z) {
      if (!d.player.entity) return;
      const p = d.player.entity.getPosition();
      d.player.clearPath();
      d.player.entity.setPosition(x, p.y, z);
      d.player.x = Math.round(x);
      d.player.z = Math.round(z);
    },
    refreshHud() {
      if (!d.sheet) return;
      d.paintHud(d.sheet);
      d.loot.refreshPanel(d.sheet);
    },
    armPick: (callback) => d.setPendingGodPick(callback),
    get picking() { return !!d.pendingGodPick; },
    advanceFireTurn: () => d.runtime.advanceTurn(),
  };
}
