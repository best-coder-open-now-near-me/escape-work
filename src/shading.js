// The look of the game, in one place: toon-banded lighting, ink outlines,
// material construction, and the camera post stack. Everything that decides
// how a pixel shades lives here; what gets drawn lives in tile-renderer.js /
// models.js; where it goes lives in scene.js.
const pc = window.pc;

// Cel shading: replace the lambert term so each light's contribution snaps to
// a few discrete bands (with a whisker of smoothstep so band edges don't
// shimmer, and a sliver of the raw term so faces inside one band keep a hint
// of modeling). The world is mostly flat-shaded boxes, so in practice every
// face lands cleanly on one band - a graphic, toon-flat look instead of soft
// gradients.
const TOON_CHUNK = `
float getLightDiffuse(vec3 worldNormal, vec3 viewDir, vec3 lightDirNorm) {
    float d = max(dot(worldNormal, -lightDirNorm), 0.0);
    float x = d * 3.0;
    float banded = min((floor(x) + smoothstep(0.42, 0.58, fract(x))) / 3.0, 1.0);
    return banded * 0.85 + d * 0.15;
}`;

const toonified = new WeakSet();
export function toonifyMaterial(m) {
  if (toonified.has(m)) return;
  toonified.add(m);
  m.shaderChunks.glsl.set('lightDiffuseLambertPS', TOON_CHUNK);
  m.update();
}

// Apply the toon ramp to everything a loaded model renders with. Materials
// are shared per-asset, so the WeakSet keeps repeat placements from
// rebuilding shaders. Per-character damage-flash clones inherit the chunk
// through Material.copy.
export function toonifyEntity(entity) {
  for (const rc of entity.findComponents('render')) {
    for (const mi of rc.meshInstances) toonifyMaterial(mi.material);
  }
}

// Ink outlines, inverted-hull style: every .glb model is drawn a second time
// with its vertices pushed out along their normals and front faces culled, in
// flat black - only the silhouette shell survives, reading as a drawn ink
// line. The copies share the originals' skin instances so they track skeletal
// animation for free. Tiles and walls stay clean (their SSAO edge does that
// work) - the ink belongs on characters and furniture.
//
// The custom transformVS chunk inflates in world space. It runs before the
// normal chunks in the assembled shader, so the normal helpers are forward-
// declared (their definitions arrive later from normalCoreVS/normalVS, which
// exist whenever NORMALS is defined - true for this lit material's forward
// pass; shadow/depth variants compile the un-inflated fallback).
const OUTLINE_TRANSFORM_CHUNK = `
#ifdef NORMALS
vec3 getLocalNormal(vec3 vertexNormal);
mat3 getNormalMatrix(mat4 modelMatrix);
#endif
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
    vec4 posW = modelMatrix * vec4(getLocalPosition(vertexPosition), 1.0);
#ifdef NORMALS
    vec3 worldN = normalize(getNormalMatrix(modelMatrix) * getLocalNormal(vec3(0.0)));
    posW.xyz += worldN * 0.012;
#endif
    return posW;
}
vec4 getPosition() {
    dModelMatrix = getModelMatrix();
    vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
    dPositionW = posW.xyz;
    return matrix_viewProjection * posW;
}
vec3 getWorldPosition() {
    return dPositionW;
}
`;

let outlineMat = null;
function getOutlineMat() {
  if (outlineMat) return outlineMat;
  outlineMat = new pc.StandardMaterial();
  outlineMat.diffuse = new pc.Color(0, 0, 0);
  outlineMat.specular = new pc.Color(0, 0, 0);
  outlineMat.gloss = 0;
  outlineMat.cull = pc.CULLFACE_FRONT;
  outlineMat.shaderChunks.glsl.set('transformVS', OUTLINE_TRANSFORM_CHUNK);
  outlineMat.update();
  return outlineMat;
}

export function addOutlines(holder) {
  const mat = getOutlineMat();
  const copies = [];
  for (const rc of holder.findComponents('render')) {
    for (const mi of rc.meshInstances) {
      if (mi.material === mat) continue;
      const omi = new pc.MeshInstance(mi.mesh, mat, mi.node);
      if (mi.skinInstance) omi.skinInstance = mi.skinInstance;
      copies.push(omi);
    }
  }
  if (!copies.length) return;
  // A sibling render component, NOT appended to the original's meshInstances:
  // that setter destroys the instances it replaces.
  const shell = new pc.Entity('outlines');
  shell.addComponent('render', { meshInstances: copies, castShadows: false });
  holder.addChild(shell);
}

// Post stack on the game camera (also used by the editor - controls.js calls
// this wherever the camera rig is built). SSAO grounds props and walls with
// contact shading the flat toon lighting can't provide, a whisper of bloom
// makes the emissives (exit, fire, sparks) glow, and the grade adds the
// saturation and warmth the toon bands need to read.
export function applyCameraPostFx(app, cameraEntity) {
  const frame = new pc.CameraFrame(app, cameraEntity.camera);
  frame.rendering.samples = 4; // keep MSAA through the post pipeline
  frame.ssao.type = pc.SSAOTYPE_COMBINE;
  frame.ssao.intensity = 0.4;
  frame.ssao.radius = 9;
  frame.ssao.power = 5;
  frame.bloom.intensity = 0.02;
  frame.grading.enabled = true;
  frame.grading.contrast = 1.06;
  frame.grading.saturation = 1.18;
  frame.vignette.intensity = 0.5;
  frame.vignette.inner = 0.55;
  frame.vignette.outer = 1.35;
  frame.vignette.curvature = 0.6;
  frame.update();
  return frame;
}

export function makeMaterial(rgb, { opacity = 1, gloss = null, emissive = null } = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
  if (gloss !== null) m.gloss = gloss;
  if (opacity < 1) {
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (emissive) m.emissive = new pc.Color(emissive[0], emissive[1], emissive[2]);
  toonifyMaterial(m);
  return m;
}
