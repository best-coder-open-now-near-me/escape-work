// Loading and tuning .glb models: asset reuse, the anim state graph for
// characters, and the proportion retune that de-chibis the Kenney rigs.
import { toonifyEntity, addOutlines } from './shading.js';

const pc = window.pc;

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
export function placeModel(app, url, tileX, tileZ, { scale = 1, lift = 0.1, rotY = 0, onReady = null, animate = false } = {}) {
  // Reuse the asset if this .glb was already requested (props repeat a lot,
  // and the editor repaints cells constantly).
  let asset = app.assets.find(url);
  if (!asset) {
    asset = new pc.Asset(url, 'container', { url });
    // Attach the error handler ONCE, when the asset is first created - it's a
    // persistent listener on a shared asset, so re-adding it per placeModel
    // call (the editor repaints constantly) would leak handlers unbounded.
    asset.on('error', (err) => console.warn('asset load failed:', url, err));
    app.assets.add(asset);
  }
  asset.ready(() => {
    const holder = new pc.Entity(url);
    const inst = asset.resource.instantiateRenderEntity();
    holder.addChild(inst);
    toonifyEntity(holder);
    addOutlines(holder);
    if (animate) setupAnim(inst, asset);
    holder.setLocalScale(scale, scale, scale);
    holder.setEulerAngles(0, rotY, 0);
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
  top.setLocalPosition(tp.x, tp.y + hipY * (legs - 1), tp.z);
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
