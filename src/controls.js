// Camera rig + mouse input. Translates raw events into semantic game input:
// onLeftClickTile(tile) / onRightClickTile(tile, screenX, screenY). Orbiting
// and zooming are handled entirely in here - game logic never sees them.
import { applyCameraPostFx } from './shading.js';

const pc = window.pc;

// `onTacticalChange` fires whenever the tactical view goes on or off - by the
// button, by the T key, by a pitch drag, or by a raw setView. Anything PAINTING
// that state has to hear about all four: the HUD button used to repaint only on
// its own click, so an orbit drag left it lit over a view it no longer had, and
// clicking it to "turn it off" toggled a null state back ON.
//
// `aim` is the impairment hook (src/vision.js): a blinded character's aim does
// not land where their player's mouse is, so every pointer coordinate that asks
// the WORLD a question goes through it first. Deliberately only the left click
// and the hover - the right-click menu and the editor's drag-paint stay exact,
// because blind should make you fumble a swing, not a menu.
export function createControls({ app, canvas, focus, onLeftClickTile, onRightClickTile, onAnyLeftPress, onLeftDragTile, onHover, onHoverLeave, onTacticalChange = null, aim = null }) {
  // Rig: camYaw (spins around the focus) -> camPitch (tilts) -> camera (sits
  // back at a fixed distance, looking at the focus).
  const camYaw = new pc.Entity('camYaw');
  const camPitch = new pc.Entity('camPitch');
  const cameraEntity = new pc.Entity('camera');
  camYaw.addChild(camPitch);
  camPitch.addChild(cameraEntity);
  app.root.addChild(camYaw);
  // Perspective, Baldur's Gate style: a fairly tight FOV looking down at the
  // world, zooming by dollying the camera in and out.
  cameraEntity.addComponent('camera', {
    projection: pc.PROJECTION_PERSPECTIVE,
    fov: 35,
    // Linear-space value: the post pipeline gamma-encodes on output, so this
    // is much lower than the old direct-to-screen 0.1 to keep the same dark
    // void around the floor.
    clearColor: new pc.Color(0.012, 0.012, 0.024),
    nearClip: 0.5,
    farClip: 300,
  });
  applyCameraPostFx(app, cameraEntity);

  const CAM = {
    yaw: 45, pitch: 55, dist: 26,
    minDist: 9, maxDist: 42, minPitch: 18, maxPitch: 80,
  };
  // The TACTICAL view: straight down the Y axis, the way a battle map is drawn.
  // Deliberately past maxPitch - the orbit clamp exists to stop you tumbling
  // into a useless near-horizon view by accident, not to forbid the one
  // overhead angle where tile boundaries stop foreshortening and a click
  // lands exactly where it looks like it will. Non-null while it is up, and it
  // remembers the view to put back.
  let tactical = null;
  const TACTICAL_PITCH = 90;
  // Every exit from the view goes through here, so the notification can't be
  // forgotten by whichever path drops it next.
  function dropTactical() {
    if (!tactical) return;
    tactical = null;
    onTacticalChange?.(false);
  }
  function apply() {
    camYaw.setLocalEulerAngles(0, CAM.yaw, 0);
    camPitch.setLocalEulerAngles(-CAM.pitch, 0, 0);
    cameraEntity.setLocalPosition(0, 0, CAM.dist);
  }
  apply();
  camYaw.setPosition(focus.x, 0.3, focus.z);

  app.mouse.disableContextMenu(); // the game draws its own right-click menu
  // Chromium starts autoscroll on middle-press; suppress just the default.
  canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  // Keep wheel events inside the game: without this the browser (or the
  // itch.io page hosting the iframe) scrolls instead of zooming.
  canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

  // PlayCanvas attaches its mouse listeners to WINDOW, so clicks on DOM UI
  // (combat buttons, menus, the editor bar) also arrive here - mousedown even
  // fires BEFORE the button's own click event. Only events that actually
  // start on the canvas may begin a game interaction.
  const onCanvas = (e) => !e.event || e.event.target === canvas;

  let orbiting = false;
  let leftHeld = false; // for drag-painting in the editor
  let hoveringCanvas = false; // was the last hover over the world, not the UI?
  // The last RAW pointer position on the canvas. Kept because an impaired aim
  // keeps drifting while the mouse sits still: refreshHover below re-asks the
  // world what is under the swaying crosshair on frames no mouse event arrives.
  let lastX = 0;
  let lastY = 0;
  let haveMouse = false;
  const aimed = (sx, sy) => (aim ? aim(sx, sy) : [sx, sy]);
  app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
    if (!onCanvas(e)) return;
    if (e.button === pc.MOUSEBUTTON_MIDDLE) {
      orbiting = true;
    } else if (e.button === pc.MOUSEBUTTON_LEFT) {
      leftHeld = true;
      onAnyLeftPress && onAnyLeftPress();
      const [ax, ay] = aimed(e.x, e.y);
      onLeftClickTile && onLeftClickTile(screenToTile(ax, ay), screenToGround(ax, ay), ax, ay);
    } else if (e.button === pc.MOUSEBUTTON_RIGHT) {
      onRightClickTile && onRightClickTile(screenToTile(e.x, e.y), e.x, e.y, screenToGround(e.x, e.y));
    }
  });
  // Releases are never filtered - an orbit/drag must end even over UI.
  app.mouse.on(pc.EVENT_MOUSEUP, (e) => {
    if (e.button === pc.MOUSEBUTTON_MIDDLE) orbiting = false;
    if (e.button === pc.MOUSEBUTTON_LEFT) leftHeld = false;
  });
  app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
    if (orbiting) {
      // an orbit in progress keeps tracking even across UI
      CAM.yaw -= e.dx * 0.3;
      // Tilting by hand is how you leave the tactical view - it sits past the
      // orbit's own pitch clamp, so the first drag would otherwise snap the
      // camera down to maxPitch while the button still claimed it was on.
      if (e.dy) dropTactical();
      CAM.pitch = pc.math.clamp(CAM.pitch + e.dy * 0.3, CAM.minPitch, CAM.maxPitch);
      apply();
    } else if (leftHeld && onLeftDragTile && onCanvas(e)) {
      onLeftDragTile(screenToTile(e.x, e.y), screenToGround(e.x, e.y));
    } else if (onCanvas(e)) {
      hoveringCanvas = true;
      lastX = e.x;
      lastY = e.y;
      haveMouse = true;
      const [ax, ay] = aimed(e.x, e.y);
      onHover && onHover(screenToGround(ax, ay), ax, ay);
    } else if (hoveringCanvas) {
      // The cursor slid off the world and onto DOM UI. Say so ONCE: hover
      // events over UI used to be dropped entirely, so nothing ever told the
      // game the world hover had ended - the enemy you slid off kept its
      // highlight and the focus banner kept naming them the whole time the
      // pointer sat on the hotbar.
      hoveringCanvas = false;
      onHoverLeave && onHoverLeave();
    }
  });
  app.mouse.on(pc.EVENT_MOUSEWHEEL, (e) => {
    if (!onCanvas(e)) return; // scrolling over a panel must not zoom
    // Scroll up (away from you) zooms in - wheelDelta is negative for
    // scroll-up, so adding it pulls the camera closer.
    CAM.dist = pc.math.clamp(CAM.dist + e.wheelDelta * 2.4, CAM.minDist, CAM.maxDist);
    apply();
  });

  // Turn a screen pixel into a precise point on the ground plane...
  const _near = new pc.Vec3();
  const _far = new pc.Vec3();
  function screenToGround(sx, sy) {
    cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.nearClip, _near);
    cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.farClip, _far);
    const dir = _far.clone().sub(_near);
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (0 - _near.y) / dir.y;
    if (t < 0) return null;
    const p = _near.add(dir.scale(t));
    return { x: p.x, z: p.z };
  }
  // ...and into the grid tile under it (the editor also wants the raw point,
  // to know which EDGE of the tile was clicked when painting partitions).
  function screenToTile(sx, sy) {
    const p = screenToGround(sx, sy);
    return p ? { x: Math.round(p.x), z: Math.round(p.z) } : null;
  }

  // The height the rig looks at: floor-ish for play, chest height when the
  // class carousel frames a candidate.
  let focusHeight = 0.3;

  // Camera shake: an impact nudges the rig's focus point and lets it settle.
  // Deliberately SMALL and SHORT (a hit is ~5 screen pixels at the default
  // boom, gone in a quarter second) - this is punctuation for an explosion or
  // a body hitting the floor, not a screen-wrecking rumble, and anything
  // aiming at a projected world point (the loot labels, the e2e helpers)
  // still lands where it looked.
  const SHAKE_MAX = 0.16; // world units of focus displacement, hard cap
  let shakeT = 0;
  let shakeDur = 0.25;
  let shakeAmp = 0;
  let shakeClock = 0;
  function shake(amp = 0.08, dur = 0.25) {
    // A second impact during a shake takes over only if it's bigger - a volley
    // of small hits must not sum into a quake.
    if (shakeT > 0 && amp <= shakeAmp) return;
    shakeAmp = Math.min(amp, SHAKE_MAX);
    shakeDur = dur;
    shakeT = dur;
  }

  // Ease the rig toward the target each frame so the camera trails the player.
  // Time-based smoothing, so the trailing speed is framerate-independent.
  // The shake offset is added to a base point tracked SEPARATELY from the
  // entity's transform: easing from the shaken position would feed each
  // frame's wobble back into the next one's start.
  let baseX = focus.x;
  let baseZ = focus.z;
  function follow(target, dt = 1 / 60) {
    const k = 1 - Math.exp(-dt * 7);
    baseX = pc.math.lerp(baseX, target.x, k);
    baseZ = pc.math.lerp(baseZ, target.z, k);
    let ox = 0;
    let oz = 0;
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - dt);
      shakeClock += dt;
      // Squared falloff, and two incommensurable frequencies so the wobble
      // never looks like a loop. No Math.random per frame: a deterministic
      // shake is one less thing that can differ between two runs of a test.
      const decay = (shakeT / shakeDur) ** 2;
      ox = Math.sin(shakeClock * 47) * shakeAmp * decay;
      oz = Math.sin(shakeClock * 39 + 1.7) * shakeAmp * decay;
      if (shakeT === 0) shakeAmp = 0;
    }
    camYaw.setPosition(baseX + ox, focusHeight, baseZ + oz);
  }

  // Programmatic camera override (the class-picker carousel frames the
  // candidate close and head-on, past the wheel/orbit limits). Values apply
  // raw - callers restore the defaults when done.
  function setView({ dist, pitch, yaw, focusY } = {}) {
    if (dist !== undefined) CAM.dist = pc.math.clamp(dist, 1, CAM.maxDist);
    // A raw pitch override (the class carousel) supersedes the tactical view -
    // drop the banked framing rather than restoring it over the caller later.
    if (pitch !== undefined) { CAM.pitch = pitch; dropTactical(); }
    if (yaw !== undefined) CAM.yaw = yaw;
    if (focusY !== undefined) focusHeight = focusY;
    apply();
  }

  // Drop into (or out of) the overhead tactical view. Going in banks the
  // current pitch/dist; coming out restores exactly what you were looking at,
  // so toggling it for one careful move doesn't cost you your framing.
  // Returns the state it settled on.
  function setTactical(on) {
    if (!!on === !!tactical) return !!tactical;
    if (on) {
      tactical = { pitch: CAM.pitch, dist: CAM.dist };
      CAM.pitch = TACTICAL_PITCH;
      // Pull back a little if you were in close: straight down from a tight
      // boom shows a handful of tiles and defeats the point of the view.
      CAM.dist = Math.max(CAM.dist, 22);
    } else {
      CAM.pitch = tactical.pitch;
      CAM.dist = tactical.dist;
      dropTactical();
    }
    apply();
    if (on) onTacticalChange?.(true);
    return !!tactical;
  }

  return {
    cameraEntity,
    screenToTile,
    screenToGround,
    // Re-ask the world what the aim is on, from the last known mouse position.
    // Only an impaired aim needs this: a hover reading is normally as fresh as
    // the mouse that produced it, but a drifting one goes stale the instant the
    // player stops moving - the crosshair would sit lit on a coworker the sway
    // had already carried it off, and hover.js's whole rule is that the preview
    // IS the click. main.js calls it per frame while the sway is live.
    refreshHover() {
      if (!haveMouse || !hoveringCanvas || !onHover) return;
      const [ax, ay] = aimed(lastX, lastY);
      onHover(screenToGround(ax, ay), ax, ay);
    },
    follow,
    shake,
    setView,
    setTactical,
    toggleTactical: () => setTactical(!tactical),
    get tactical() { return !!tactical; },
  };
}
