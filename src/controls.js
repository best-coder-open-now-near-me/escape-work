// Camera rig + mouse input. Translates raw events into semantic game input:
// onLeftClickTile(tile) / onRightClickTile(tile, screenX, screenY). Orbiting
// and zooming are handled entirely in here - game logic never sees them.
import { applyCameraPostFx } from './shading.js';

const pc = window.pc;

export function createControls({ app, canvas, focus, onLeftClickTile, onRightClickTile, onAnyLeftPress, onLeftDragTile, onHover }) {
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
  app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
    if (!onCanvas(e)) return;
    if (e.button === pc.MOUSEBUTTON_MIDDLE) {
      orbiting = true;
    } else if (e.button === pc.MOUSEBUTTON_LEFT) {
      leftHeld = true;
      onAnyLeftPress && onAnyLeftPress();
      onLeftClickTile && onLeftClickTile(screenToTile(e.x, e.y), screenToGround(e.x, e.y));
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
      CAM.pitch = pc.math.clamp(CAM.pitch + e.dy * 0.3, CAM.minPitch, CAM.maxPitch);
      apply();
    } else if (leftHeld && onLeftDragTile && onCanvas(e)) {
      onLeftDragTile(screenToTile(e.x, e.y), screenToGround(e.x, e.y));
    } else if (onHover && onCanvas(e)) {
      onHover(screenToGround(e.x, e.y), e.x, e.y);
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

  // Ease the rig toward the target each frame so the camera trails the player.
  // Time-based smoothing, so the trailing speed is framerate-independent.
  function follow(target, dt = 1 / 60) {
    const k = 1 - Math.exp(-dt * 7);
    const c = camYaw.getPosition();
    camYaw.setPosition(pc.math.lerp(c.x, target.x, k), 0.3, pc.math.lerp(c.z, target.z, k));
  }

  // Programmatic dolly (the class-picker carousel zooms in on the candidate).
  // Allows closer than the wheel's minDist; callers restore a sane distance.
  function setZoom(dist) {
    CAM.dist = pc.math.clamp(dist, 5, CAM.maxDist);
    apply();
  }

  return { cameraEntity, screenToTile, screenToGround, follow, setZoom };
}
