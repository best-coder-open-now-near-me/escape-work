// Loading and tuning .glb models: asset reuse, the anim state graph for
// characters, and the proportion retune that de-chibis the Kenney rigs.
import { toonifyEntity, addOutlines } from './shading.js';

// Resolved LAZILY, not read at import. `const pc = window.pc` made this module
// - and everything importing it, which includes actors.js - impossible to load
// outside a browser, so the pure parts (proportions, material cloning, the tint
// rule) could not be unit-tested even though none of them touch a renderer.
// Both uses below are genuine engine calls, so they resolve it at call time.
const pc = () => window.pc;

// The character .glbs ship with a full baked clip set (idle, walk, attacks,
// die, sit...). Wire the ones the game drives into an anim component with an
// auto-generated state graph - actors switch states via GridActor.setClip.
// First assignment ('idle') becomes the initial state.
const ACTOR_CLIPS = ['idle', 'walk', 'attack-melee-right'];
function setupAnim(inst, asset) {
  const tracks = {};
  for (const a of asset.resource.animations) {
    if (a.resource) tracks[a.resource.name] = a.resource;
  }
  if (!tracks.idle) return;
  inst.addComponent('anim', { activate: true });
  for (const name of ACTOR_CLIPS) {
    if (tracks[name]) inst.anim.assignAnimation(name, tracks[name]);
  }
}

// Load a .glb, wrap it in a holder (so scaling/rotating is predictable), and
// drop it on a tile. Reusable for every prop and character.
// `tiltX`/`tiltZ` lay a prop over (POWERS_PLAN M6). Everything the game placed
// before toppling stood upright, so `rotY` alone was the whole vocabulary; a
// fallen bookcase needs to rotate about an axis in the floor plane, and a
// bespoke second placement path for the one case would have been a parallel
// copy of the asset caching, the toonify and the outline pass.
export function placeModel(app, url, tileX, tileZ, { scale = 1, lift = 0.1, rotY = 0, tiltX = 0, tiltZ = 0, onReady = null, animate = false } = {}) {
  // Reuse the asset if this .glb was already requested (props repeat a lot,
  // and the editor repaints cells constantly).
  let asset = app.assets.find(url);
  if (!asset) {
    asset = new (pc().Asset)(url, 'container', { url });
    // Attach the error handler ONCE, when the asset is first created - it's a
    // persistent listener on a shared asset, so re-adding it per placeModel
    // call (the editor repaints constantly) would leak handlers unbounded.
    asset.on('error', (err) => { asset.loadFailed = true; console.warn('asset load failed:', url, err); });
    app.assets.add(asset);
  }
  // A failed load has to leave something you can SEE. `asset.ready` simply
  // never fires on an error, so the prop was absent, `onReady` never ran, and
  // the only trace was a console warning nobody reads mid-playtest - which
  // makes a missing .glb indistinguishable from a level that never placed the
  // prop at all. A magenta box is the oldest marker in the business for
  // exactly this, and it keeps the callback contract: whatever was going to
  // happen to the model still happens, to the marker.
  const placeFallback = () => {
    const holder = new (pc().Entity)(`missing:${url}`);
    holder.addComponent('render', { type: 'box' });
    const mat = new (pc().StandardMaterial)();
    mat.diffuse = new (pc().Color)(1, 0, 1);
    mat.update();
    holder.render.material = mat;
    holder.setLocalScale(0.5 * scale, 0.5 * scale, 0.5 * scale);
    holder.setEulerAngles(tiltX, rotY, tiltZ);
    holder.setPosition(tileX, lift + 0.25, tileZ);
    app.root.addChild(holder);
    if (onReady) onReady(holder);
  };
  if (asset.loadFailed) { placeFallback(); return; } // already known bad - don't re-wait
  // Per-CALL listener, so this placement gets its own marker - but removed the
  // moment either outcome lands, so the editor's constant repainting cannot
  // pile handlers up on a shared asset (the reason the warning above is
  // attached once and this is not). `settled` is what guarantees exactly one
  // of the two runs: `ready` and `error` are independent, and a placement that
  // drew both a model and a marker would be worse than either.
  let settled = false;
  const onLoadError = () => { if (settled) return; settled = true; placeFallback(); };
  asset.once('error', onLoadError);
  asset.ready(() => {
    if (settled) return;
    settled = true;
    asset.off('error', onLoadError);
    const holder = new (pc().Entity)(url);
    const inst = asset.resource.instantiateRenderEntity();
    holder.addChild(inst);
    toonifyEntity(holder);
    addOutlines(holder);
    if (animate) setupAnim(inst, asset);
    holder.setLocalScale(scale, scale, scale);
    holder.setEulerAngles(tiltX, rotY, tiltZ);
    holder.setPosition(tileX, lift, tileZ);
    app.root.addChild(holder);
    if (onReady) onReady(holder);
  });
  app.assets.load(asset);
}

// De-chibi the Kenney mini rigs. Every character shares the same 7-bone
// skeleton (root -> leg-left/leg-right + torso -> arm-left/arm-right + head)
// with no knees or elbows, so proportions are retuned by scaling bones:
// legs and torso stretch, the head shrinks back toward realistic. Height
// belongs in `legs`: arms/head hang off the torso and their counter-scales
// only cancel the torso stretch in the bind pose - once a clip rotates an
// arm to hang down, a big torso Y stretch runs along the arm's length and
// visibly distorts it, so keep `torso` modest. Legs are single rigid bones
// hip-to-foot with nothing attached; 1.9 was checked against the walk cycle
// in-game and still swings fine - go carefully beyond that.
const PROPORTIONS = { legs: 1.9, torso: 1.3, head: 0.62, arms: 0.7 };

// `build` (from a character's data `look.build`) nudges those proportions per
// character TYPE, so the several entries that share one .glb still read as
// different people - a stockier veteran, a smaller intern. Only the keys given
// are overridden; the caution above about `legs` and `torso` still applies, so
// keep overrides modest.
export function applyCharacterProportions(holder, build = null) {
  const root = holder.findByName('root');
  const legL = holder.findByName('leg-left');
  const legR = holder.findByName('leg-right');
  const torso = holder.findByName('torso');
  if (!root || !legL || !torso) return; // not a rigged mini character
  const { legs, torso: torsoS, head: headS, arms: armsS } = { ...PROPORTIONS, ...(build || {}) };
  legL.setLocalScale(1, legs, 1);
  if (legR) legR.setLocalScale(1, legs, 1);
  // Legs stretch downward from the hip joint, so lift the rig by the extra
  // leg length to keep the feet on the floor. The lift goes on root's PARENT
  // (the glTF scene node) - animation clips write root's translation every
  // frame and would stomp a lift applied to root. GridActor.updateAnim ALSO
  // rewrites the scene node's position every frame, so attach() captures
  // this lift as the baseline its bob/lunge offsets compose onto - zeroing
  // it is exactly the feet-through-the-floor bug.
  const hipY = legL.getLocalPosition().y;
  const top = root.parent;
  const tp = top.getLocalPosition();
  // Set the lift from a PRISTINE baseline rather than adding to the current
  // position. The bone scales around this are setLocalScale - absolute, and so
  // already idempotent - but the lift read where the body currently was and
  // added to it, so dressing the same entity twice raised it twice. Harmless
  // while nothing ever dressed a body more than once; a build slider does it
  // forty times a second, and by the tenth tick the character is at the
  // ceiling. The baseline is stashed on the node itself so it survives however
  // many times we come back.
  if (top._dressBaseY === undefined) top._dressBaseY = tp.y;
  top.setLocalPosition(tp.x, top._dressBaseY + hipY * (legs - 1), tp.z);
  torso.setLocalScale(1, torsoS, 1);
  // Torso children inherit its stretch, which would deform them: counter it
  // on the head (shrinking it outright) and on the arms' thickness. Arms
  // extend along their bind-pose X axis (the T-pose direction), so the
  // shortening goes on bone X - it follows the arm through any clip pose.
  // Their attach points still ride up with the taller torso.
  const head = holder.findByName('head');
  if (head) head.setLocalScale(headS, headS / torsoS, headS);
  for (const name of ['arm-left', 'arm-right']) {
    const arm = holder.findByName(name);
    if (arm) arm.setLocalScale(armsS, 1 / torsoS, 1);
  }
}

// --- per-instance materials -------------------------------------------------
// Two paths dress a body: the live actor (GridActor.attach) and the class
// picker's preview, which has no actor at all. Both have to do the same two
// things, and both used to do them separately - the preview with its own inline
// copy of the tint maths, complete with the same compounding bug.
//
// 1. CLONE. A .glb's materials are shared by every character built from that
//    rig, so recolouring one in place recolours all of them.
// 2. BASELINE. Keep each clone's pristine colours. The emissive baseline is
//    what a damage flash returns to; the diffuse baseline is what a tint is
//    computed FROM - multiply the live value instead and repeated tints
//    compound, walking a body toward black as you click along a swatch row.
export function cloneMaterials(entity) {
  const mats = [];
  for (const rc of entity.findComponents('render')) {
    for (const mi of rc.meshInstances) {
      const clone = mi.material.clone();
      clone.update();
      mi.material = clone;
      mats.push({ mat: clone, emissive: clone.emissive.clone(), diffuse: clone.diffuse.clone() });
    }
  }
  return mats;
}

// Tint cloned materials from their pristine diffuse. Idempotent by
// construction, so a live swatch row can drive it. No rgb restores the original
// colours, which makes "no tint" a reachable choice rather than a dead end.
export function tintMaterials(mats, rgb) {
  for (const { mat, diffuse } of mats) {
    if (rgb) mat.diffuse.set(diffuse.r * rgb[0], diffuse.g * rgb[1], diffuse.b * rgb[2]);
    else mat.diffuse.copy(diffuse);
    mat.update();
  }
}
