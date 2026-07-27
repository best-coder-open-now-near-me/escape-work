// What the cursor says. One owner for every affordance that answers "what am I
// pointing at, and what would a click do?" - the coloured body glow, the mouse
// cursor, the focus banner, and the immediate-mode ground rings.
//
// None of this decides what a click MEANS (that is main.js's `dispatchHit`).
// It decides what the player is SHOWN before they commit, which is why it wants
// one owner: every one of these surfaces has to describe the same verb. When
// they were four separate stretches of main.js they drifted apart repeatedly -
// a crosshair over a coworker the click would refuse, a banner naming a body
// the glow had already dropped. Adding a new affordance means adding it here,
// against the same `queries`, rather than beside whichever one it resembles.
//
// It is NOT pure - it writes a cursor onto the canvas, builds highlight shells,
// and draws lines through the app - so it is not unit tested like turn-order.js.
// The seam is still worth having: main.js keeps the wiring and this keeps the
// presentation, and the rules it consults arrive as `queries` rather than being
// re-derived here (`armedTargetOk` is the click resolver's own test, not a
// second copy of it).
import { addHighlight, setHighlight } from './shading.js';

const pc = window.pc;

// Body-glow colours, by what the thing IS: hostile red, talkable green, party
// teal, lootable gold, neutral interactable (doors, props) cyan.
export const HL = {
  enemy: [1.0, 0.28, 0.2],
  npc: [0.42, 0.85, 0.42],
  party: [0.45, 0.9, 0.8],
  loot: [1.0, 0.82, 0.4],
  interact: [0.5, 0.8, 1.0],
};
const rgbCss = ([r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

// Aggression dot colours (data/enemies.js `aggression`): whether a coworker
// will start a fight. Green = won't initiate, yellow = talks first, red =
// straight to battle. Tints both the enemy's flanking dots and the banner
// border, so the banner reads as one aggression signal.
const AGGRO = {
  green: 'rgb(111, 200, 111)',
  yellow: 'rgb(224, 178, 58)',
  red: 'rgb(224, 80, 58)',
};

// Ground rings. Immediate-mode lines last exactly one frame, so every one of
// these has to be reissued on every frame it is meant to be visible.
const RING_OK = new pc.Color(0.42, 0.78, 0.35);
const RING_FAR = new pc.Color(0.85, 0.28, 0.24);
const REACH_RING = new pc.Color(0.55, 0.62, 0.78);
const RING_PARTY = new pc.Color(0.45, 0.9, 0.8);
const RING_DOWN = new pc.Color(1.0, 0.82, 0.4);
const RING_HOSTILE = new pc.Color(1.0, 0.28, 0.2);
const RING_FRIENDLY = new pc.Color(0.42, 0.85, 0.42);

// `queries` is the live world, asked rather than captured - the leader, the
// sheet and the armed action are all re-pointed by a leader switch, so a
// snapshot would go stale the first time the player pressed Tab:
//   party()/enemies()/summons()/npcs()  the bodies on the board
//   leader() / memberOf(actor) / sheet() / playerEntity() / reach()
//   armed()                             the armed hotbar action id, or null
//   armedTargetOk(id, enemy)            the CLICK RESOLVER's own test - the
//                                       preview is the rule, so the rings and
//                                       the crosshair ask the same question the
//                                       click will
//   doorNear(point) / doorOpen(key)     the door under a ground point
//   tileDef(x, z) / shopSoldOut(x, z)   what a prop tile is and whether it's out
//   corpseAt / looseAt / itemName       flat things the pick ray skims over
export function createHoverLayer({ app, canvas, picking, controls, ui, queries }) {
  // --- highlight shells -----------------------------------------------------
  // BG3-style inverted-hull glow, one shell per interactable, built lazily and
  // cached against the holder so a repeat hover costs nothing.
  const hlShells = new WeakMap(); // holder entity -> highlight shell (or null)
  let hoverEntity = null;
  let hoverShell = null;
  let hoverKind = null; // exposed for tests

  function shellFor(holder) {
    if (!hlShells.has(holder)) hlShells.set(holder, addHighlight(holder));
    return hlShells.get(holder);
  }
  function setHoverHighlight(holder, rgb) {
    if (holder === hoverEntity) {
      if (holder && hoverShell) setHighlight(hoverShell, true, rgb);
      return;
    }
    if (hoverShell) { try { setHighlight(hoverShell, false); } catch { /* holder gone */ } }
    hoverEntity = holder;
    hoverShell = holder ? shellFor(holder) : null;
    if (hoverShell) setHighlight(hoverShell, true, rgb);
  }
  const clearHighlight = () => setHoverHighlight(null, null);
  const setCursor = (c) => { if (canvas) canvas.style.cursor = c || ''; };

  // --- the glow gate --------------------------------------------------------
  // OUT of combat the body glow is an INSPECT verb, not an ambient one: held
  // behind Ctrl or Alt, the two keys that already mean "show me what's there"
  // (rings under every character, labels over every lootable). Lit on plain
  // hover it fired on everything the cursor crossed - doors, desks, bystanders
  // - and a light that is always on stops meaning anything.
  //
  // IN combat it's ungated. There the cursor is only ever aiming, and the hover
  // path hands us characters and nothing else, so the glow can't spill onto
  // scenery the way it does out of combat. Making the player hold a key to see
  // who they're about to swing at was asking for the modifier in the one half
  // of the game where the answer is always wanted.
  //
  // What the cursor is over is tracked ALWAYS (`hoverTarget`), and the gate only
  // decides whether it's lit. That's what lets pressing the key light up what
  // you're already pointing at, instead of nothing happening until you jiggle
  // the mouse to provoke a fresh hover event.
  let hoverTarget = null; // { entity, rgb, hit } under the cursor, lit or not
  let ctrlHeld = false;
  let altHeld = false;
  const glowHeld = () => ctrlHeld || altHeld;
  const glowLit = () => glowHeld() || queries.inCombat();

  function applyGlow() {
    if (glowLit() && hoverTarget) setHoverHighlight(hoverTarget.entity, hoverTarget.rgb);
    else clearHighlight();
  }
  const colorForHit = (hit) =>
    hit.kind === 'enemy' ? (hit.ref.alive ? HL.enemy : HL.loot)
      : hit.kind === 'npc' ? HL.npc
        : hit.kind === 'party' ? HL.party : HL.interact;
  // Remember what's under the cursor and light it if the glow is active. The
  // hit rides along so the reach ring can ask what KIND of thing this is.
  function track(hit) {
    hoverTarget = hit?.entity ? { entity: hit.entity, rgb: colorForHit(hit), hit } : null;
    applyGlow();
  }

  // --- the focus banner -----------------------------------------------------
  // The banner's label for whatever the cursor is over: an interactable entity,
  // or a flat target the pick ray skims (a corpse, dropped item, container, or
  // door edge on the floor). Null over bare floor - nothing worth naming.
  // Mirrors the click dispatch and the cursor below, so the banner always
  // describes the verb a click would actually take.
  function focusInfoFor(hit, point) {
    if (hit) {
      const { kind, ref } = hit;
      if (kind === 'enemy') {
        if (ref.alive) {
          const ag = AGGRO[ref.def.aggression] || AGGRO.red;
          return { name: ref.def.name, sub: `Lv ${ref.def.level || 1} · HP ${ref.hp}/${ref.maxHp}`, color: ag, dotColor: ag };
        }
        return { name: ref.def.name, sub: ref.loot?.length ? 'Body · lootable' : 'Body · picked clean', color: rgbCss(HL.loot) };
      }
      if (kind === 'npc') return { name: ref.def.name, sub: 'Coworker · talk', color: rgbCss(HL.npc) };
      if (kind === 'party') {
        const m = queries.memberOf(ref);
        if (!m || (m === queries.leader() && m.sheet.hp > 0)) return null; // yourself: not news
        const sub = m.sheet.hp <= 0 ? 'Down · help up' : `Party · HP ${m.sheet.hp}/${m.sheet.maxHp}`;
        return { name: m.sheet.name, sub, color: rgbCss(HL.party) };
      }
      if (kind === 'door') {
        const open = queries.doorOpen(ref);
        return { name: open ? 'Door · open' : 'Door · closed', sub: open ? 'Close' : 'Open', color: rgbCss(HL.interact) };
      }
      if (kind === 'prop') {
        const def = queries.tileDef(ref.x, ref.z);
        const sub = def.shop
          ? (queries.shopSoldOut(ref.x, ref.z) ? 'Sold out' : 'Merchant · buy')
          : def.loot ? 'Rummage' : def.explosive ? 'Volatile' : def.ignitable ? 'Flammable' : 'Object';
        return { name: def.label || 'Object', sub, color: rgbCss(def.loot || def.shop ? HL.loot : HL.interact) };
      }
    }
    if (point) {
      const tx = Math.round(point.x);
      const tz = Math.round(point.z);
      const corpse = queries.corpseAt(tx, tz);
      if (corpse) return { name: corpse.def.name, sub: 'Body · lootable', color: rgbCss(HL.loot) };
      const loose = queries.looseAt(tx, tz);
      if (loose.length) {
        const extra = loose.length > 1 ? ` +${loose.length - 1}` : '';
        return { name: queries.itemName(loose[0].id) + extra, sub: 'Pick up', color: rgbCss(HL.loot) };
      }
      const doorKey = queries.doorNear(point);
      if (doorKey) {
        const open = queries.doorOpen(doorKey);
        return { name: open ? 'Door · open' : 'Door · closed', sub: open ? 'Close' : 'Open', color: rgbCss(HL.interact) };
      }
      if (queries.tileDef(tx, tz).loot) return { name: queries.tileDef(tx, tz).label, sub: 'Rummage', color: rgbCss(HL.loot) };
    }
    return null;
  }

  // --- the cursor -----------------------------------------------------------
  function cursorFor(hit, point) {
    const armed = queries.armed();
    if (armed) {
      if (hit && hit.kind === 'enemy' && hit.ref.alive) {
        return queries.armedTargetOk(armed, hit.ref) ? 'crosshair' : 'not-allowed';
      }
      return 'default';
    }
    if (hit) {
      if (hit.kind === 'enemy') return hit.ref.alive ? 'crosshair' : 'pointer';
      if (hit.kind === 'npc') return 'help';
      return 'pointer'; // door, prop
    }
    // Flat targets the pick ray misses (corpses, dropped items, a door edge
    // clicked on the floor) still deserve the interact cursor.
    if (point) {
      const tx = Math.round(point.x);
      const tz = Math.round(point.z);
      if (queries.doorNear(point)) return 'pointer';
      if (queries.corpseAt(tx, tz) || queries.looseAt(tx, tz).length || queries.tileDef(tx, tz).loot) return 'pointer';
    }
    return 'default';
  }

  // --- rings ----------------------------------------------------------------
  function ring(cx, cz, r, color, y = 0.14) {
    const SEGS = 18;
    let prev = null;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const p = new pc.Vec3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      if (prev) app.drawLine(prev, p, color);
      prev = p;
    }
  }

  return {
    // --- what the cursor is on --------------------------------------------
    // The out-of-combat pass: pick the entity under the pixel, remember it,
    // colour the cursor and name it in the banner. One pick feeds all three, so
    // they cannot disagree about what is being pointed at.
    hover(point, sx, sy) {
      const hit = picking.pick(controls.cameraEntity, sx, sy);
      hoverKind = hit ? hit.kind : null;
      track(hit); // lit only while Ctrl/Alt is held
      setCursor(cursorFor(hit, point));
      ui.setFocusBanner(focusInfoFor(hit, point));
      return hit;
    },
    // The in-combat pass shows CHARACTERS only - combat.js owns the cursor
    // there (it keys off whether a click would actually swing), so this is the
    // glow and the banner alone. Pass null to show nothing.
    showCharacter(hit, point) {
      hoverKind = hit ? hit.kind : null;
      track(hit);
      ui.setFocusBanner(hit ? focusInfoFor(hit, point) : null);
    },
    setCursor,
    // Drop the world hover entirely: the cursor left for the DOM UI, a panel
    // opened, or the fight started. Leaves nothing glowing behind a panel.
    clear() {
      hoverKind = null;
      clearHighlight();
      setCursor(null);
      ui.setFocusBanner(null);
    },

    // --- the inspect modifiers --------------------------------------------
    // Setting a modifier re-lights immediately, so the key shows you what the
    // cursor is ALREADY on rather than waiting for the next mouse move.
    setCtrl(v) { ctrlHeld = v; applyGlow(); },
    setAlt(v) { altHeld = v; applyGlow(); },
    releaseModifiers() { ctrlHeld = false; altHeld = false; applyGlow(); },
    get ctrlHeld() { return ctrlHeld; },
    get glowHeld() { return glowHeld(); },

    // --- per-frame rings ---------------------------------------------------
    // Green where a click would open the fight with the armed action, red where
    // it would refuse. Same test the click runs (`armedTargetOk`).
    drawArmedTargets() {
      const armed = queries.armed();
      if (!armed) return;
      for (const en of queries.enemies()) {
        if (!en.alive || !en.entity) continue;
        const pos = en.entity.getPosition();
        ring(pos.x, pos.z, 0.5, queries.armedTargetOk(armed, en) ? RING_OK : RING_FAR);
      }
    },
    // A ground ring under EVERY character at their true position - tall meshes
    // read a tile off at this camera angle, so the ring is where a click
    // actually lands. Party teal, enemies red, NPCs green, the downed gold
    // (they're a help-up target, not a threat).
    drawCharacterRings() {
      for (const m of queries.party()?.members || []) {
        if (!m.actor?.entity) continue;
        const p = m.actor.entity.getPosition();
        ring(p.x, p.z, 0.42, m.sheet.hp <= 0 ? RING_DOWN : RING_PARTY);
      }
      for (const en of queries.enemies()) {
        if (!en.alive || !en.entity) continue;
        const p = en.entity.getPosition();
        ring(p.x, p.z, 0.5, RING_HOSTILE);
      }
      for (const s of queries.summons()) {
        if (s.sheet.hp <= 0 || !s.actor.entity) continue;
        const p = s.actor.entity.getPosition();
        ring(p.x, p.z, 0.42, RING_PARTY); // your summons ring as friendly
      }
      for (const npc of queries.npcs()) {
        if (!npc.entity) continue;
        const p = npc.entity.getPosition();
        ring(p.x, p.z, 0.42, RING_FRIENDLY);
      }
    },
    // How far YOU can swing - so it belongs over a coworker and nowhere else.
    // Behind the inspect modifier, alongside the hover aura it accompanies,
    // because out here nothing is aiming by default.
    drawReachRing() {
      const hit = hoverTarget?.hit;
      if (!hit || hit.kind !== 'enemy' || !hit.ref.alive) return;
      const p = queries.playerEntity()?.getPosition();
      if (!p) return;
      ring(p.x, p.z, queries.reach(), REACH_RING);
    },

    // --- the debug/test surface -------------------------------------------
    get hoverKind() { return hoverKind; },
    get glowing() { return !!(glowLit() && hoverTarget); },
  };
}
