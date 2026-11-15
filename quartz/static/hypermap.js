// Hyperbolic map of Morra, drawn natively on the hyperbolic plane (Poincaré disk, WebGL).
// The world comes from tools/art/hyper_world.py as data, not as a picture: lines (coast,
// rivers, sea ripples, rhumbs) are dense polylines of disk points, and every mountain, wood,
// lake or town is a glyph with a position and a size in hyperbolic units. Each frame the
// points are moved by the view's Möbius transform and glyphs are drawn upright at their local
// scale, so whatever you look at up close is undistorted; only the zoomed-out view bends.
// Dragging moves along the plane, always as a pure shift, so the map never turns and north
// stays up; zoom magnifies the window onto the disk within limits, and the view cannot leave the
// coast far behind. Quartz swaps pages without reloading, so windows are set up on every "nav" event.
;(() => {
  if (window.__ddHypermap) return
  window.__ddHypermap = true
  const base = new URL("morra/", document.currentScript.src).href

  // window radius in the disk is 1 / zoom; the farthest out per projection: disk, equal-area, equidistant
  const ZOOM = { start: 3.4, max: 17, mins: [1.15, 0.2, 0.45] }
  const REACH = 4.7 // farthest hyperbolic distance of the view centre from the Tree: out over the ocean
  const INK = [0.243, 0.165, 0.09] // the brown ink of the parchment glyphs
  const RED = [0.608, 0.227, 0.141]
  const BANK = [0.29, 0.208, 0.125]
  const WATER = [0.925, 0.863, 0.706]
  const BARK_GROUND = [0.6, 0.5, 0.38] // roots: muted towards the parchment
  const SHOW_BORDERS = false // the dash-dot borders of the marsh's holdings: hidden for now
  const BARK_TREE = [0.66, 0.53, 0.37]

  // ---- complex numbers and disk automorphisms z -> (a z + b) / (conj(b) z + conj(a))
  const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]
  const conj = (p) => [p[0], -p[1]]
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]]
  const norm = ({ a, b }) => {
    const k = Math.sqrt(Math.max(1e-12, a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2))
    return { a: [a[0] / k, a[1] / k], b: [b[0] / k, b[1] / k] }
  }
  const compose = (m, n) =>
    norm({ a: add(mul(m.a, n.a), mul(m.b, conj(n.b))), b: add(mul(m.a, n.b), mul(m.b, conj(n.a))) })
  const shift = (c) => norm({ a: [1, 0], b: c })
  const apply = (m, z) => {
    const num = add(mul(m.a, z), m.b)
    const den = add(mul(conj(m.b), z), conj(m.a))
    const d = den[0] ** 2 + den[1] ** 2
    return [(num[0] * den[0] + num[1] * den[1]) / d, (num[1] * den[0] - num[0] * den[1]) / d]
  }
  const inverse = (m) => ({ a: conj(m.a), b: [-m.b[0], -m.b[1]] })
  const carry = (p, q) => compose(shift(q), shift([-p[0], -p[1]]))
  const clampDisk = (z, r = 0.995) => {
    const l = Math.hypot(z[0], z[1])
    return l > r ? [(z[0] / l) * r, (z[1] / l) * r] : z
  }

  // ---- shaders
  const COMMON = `
precision highp float;
uniform vec4 m;      // view: a = m.xy, b = m.zw
uniform vec4 screen; // width, height (device px), zoom, half of the smaller side
// the projection, as weights of three (one of them 1, mixed only while it turns):
// x the Poincaré disk, y the equal-area plane, z the equidistant plane
uniform vec3 projw;
vec2 cmul(vec2 p, vec2 q){ return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }
vec2 cdiv(vec2 p, vec2 q){ return vec2(p.x*q.x + p.y*q.y, p.y*q.x - p.x*q.y) / dot(q, q); }
vec2 mob(vec2 z){ return cdiv(cmul(m.xy, z) + m.zw, cmul(vec2(m.z, -m.w), z) + vec2(m.x, -m.y)); }
// a point at distance d from the view's centre lies, in disk units, tanh(d/2) from it on the disk,
// sinh(d/2) on the equal-area plane (equal areas stay equal) and d/2 on the equidistant one
// (distances from the centre are true); r = tanh(d/2)
float atanh_(float r){ return .5 * log((1. + r) / (1. - r)); }
float radial(float r){
  r = min(r, .9999999);
  return projw.x * r + projw.y * r * inversesqrt(max(1. - r * r, 1e-7)) + projw.z * atanh_(r);
}
vec2 proj(vec2 z){ float r = length(z); return r < 1e-7 ? z : z / r * radial(r); }
vec2 unproj(vec2 q){
  float L = length(q);
  if (projw.x > .9999 || L < 1e-7) return q;
  float lo = 0., hi = 1.;
  for (int i = 0; i < 28; i++) {
    float r = (lo + hi) * .5;
    if (radial(r) < L) lo = r; else hi = r;
  }
  return q / L * lo;
}
vec2 px(vec2 z){ return screen.xy * .5 + proj(z) * screen.z * screen.w; }
vec4 clip(vec2 p, float depth){ return vec4(p.x / screen.x * 2. - 1., 1. - p.y / screen.y * 2., depth, 1.); }
// pixels per hyperbolic unit at z: glyphs take the mean of the stretch along the radius and
// across it; on the equal-area plane that is the same everywhere
float unit(vec2 z){
  float r2 = min(dot(z, z), .9999998);
  float d = 2. * atanh_(sqrt(r2));
  float eq = d < 1e-3 ? 1. : sqrt(d / (.5 * (exp(d) - exp(-d))));
  return (projw.x * (1. - r2) + projw.y + projw.z * eq) * .5 * screen.z * screen.w;
}
`
  const BG_V = "attribute vec2 v; void main(){ gl_Position = vec4(v, 0.999, 1.); }"
  const BG_F = `${COMMON}
uniform vec3 limits;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, screen.y - gl_FragCoord.y);
  vec2 z = unproj((p - screen.xy * .5) / (screen.z * screen.w));
  vec3 paper = vec3(.925, .863, .706);   // the sea: pale parchment, the colour of every water
  vec3 unknown = vec3(.965, .945, .9);
  float grain = noise(p / 90.) * .6 + noise(p / 23.) * .3 + noise(p / 5.) * .1;
  vec3 c = paper * (.94 + .08 * grain);
  float r = length(z);
  if (r < 1.) {
    vec2 a = m.xy, b = m.zw;
    vec2 w = cdiv(cmul(vec2(a.x, -a.y), z) - b, a - cmul(vec2(b.x, -b.y), z));
    float rw = min(length(w), .999999);
    float d = log((1. + rw) / (1. - rw));
    c = mix(c, unknown, smoothstep(limits.z - .1, limits.z + .5, d));
  } else c = unknown;
  float edge = length((p - screen.xy * .5) / screen.xy * 2.);
  c *= 1. - .12 * smoothstep(.9, 1.5, edge);
  gl_FragColor = vec4(c, 1.);
}`
  const LINE_V = `${COMMON}
attribute vec2 p; attribute vec2 q; attribute vec2 corner; attribute vec3 style; attribute vec2 along;
varying float vSide; varying float vWidth; varying float vAlpha; varying float vRed; varying float vAlong; varying float vDist;
uniform float pass;  // rivers: 0 the banks, 1 the water within them; -1 every other line
void main(){
  vec2 P = mob(p), Q = mob(q);
  vec2 X = corner.x < .5 ? P : Q;
  vec2 Ps = px(P), Qs = px(Q);
  vec2 dir = Qs - Ps; float L = length(dir); dir = L > 1e-4 ? dir / L : vec2(1., 0.);
  vec2 n = vec2(-dir.y, dir.x);
  float wpx = style.x * unit(X);
  bool river = (style.z > 1.5 && style.z < 2.5) || (style.z > 4.5 && style.z < 5.5);
  float least = river ? 2.2 : .7;          // rivers stay visible from afar
  float shown = max(wpx, least);
  if (pass > .5) shown -= 2. * clamp(shown * .2, .7, 1.6);
  if (shown < .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vAlpha = style.y * (river ? 1. : clamp(wpx / .7, .12, 1.));
  float full = shown + 1.;
  vec2 pos = px(X) + dir * (corner.x * 2. - 1.) * shown * .5 + n * corner.y * full * .5;
  vSide = corner.y; vWidth = full; vRed = style.z; vAlong = corner.x; vDist = mix(along.x, along.y, corner.x);
  gl_Position = clip(pos, 0.);
}`
  const LINE_F = `
precision highp float;
varying float vSide; varying float vWidth; varying float vAlpha; varying float vRed; varying float vAlong; varying float vDist;
uniform vec3 ink; uniform vec3 red; uniform float pass; uniform vec3 bank; uniform vec3 water;
uniform vec3 bark;   // muted on the ground's roots, a little richer on the Tree's boughs
uniform float rounded;   // 1: boughs shaded round; 0: roots lie flat on the map
void main(){
  float fromEdge = (1. - abs(vSide)) * vWidth * .5;
  float a = vAlpha * clamp(fromEdge, 0., 1.);
  if (pass > -.5) {
    // rivers in two passes: dark banks (kept to the land), then water the colour of the sea
    vec3 rc = pass < .5 ? bank : water;
    gl_FragColor = vec4(rc * a, a);
    return;
  }
  vec3 c = (vRed > .5 && vRed < 1.5) || (vRed > 3.5 && vRed < 4.5) || vRed > 5.5 ? red : ink;
  if (vRed > 4.5 && vRed < 5.5) {
    // a root or a bough: bark the colour of the trunk cut, round in the light from the
    // north-west, long fibres running along it, inked edges
    if (rounded > .5) {
      // the Tree's boughs: pale wood, inked edges, grain along the limb
      float e2 = 1. - smoothstep(1.2, 2.2, fromEdge);
      float grain = step(.8, fract(vDist / .035 + abs(vSide) * 2.)) * (1. - smoothstep(.0, .9, abs(abs(vSide) - .45))) * .5;
      vec3 w = mix(bark, ink, max(e2, grain));
      float a3 = vAlpha * clamp(fromEdge, 0., 1.);
      gl_FragColor = vec4(w * a3, a3);
      return;
    }
    float v = vSide;                                   // -1 .. 1 across the limb
    float round_ = mix(1., 1. - .45 * v * v - .18 * v, rounded);   // lit on one flank, darker towards the other
    float fib = abs(fract(v * 3.2 + .35 * sin(vDist * 23. + v * 4.)) - .5);
    float fibre = smoothstep(.36, .5, fib) * (1. - smoothstep(.7, 1., abs(v)));
    vec3 col = bark * round_ * (1. - .18 * fibre);
    float edge = 1. - smoothstep(1.0, 2.0, fromEdge);
    col = mix(col, ink, edge);
    float a2 = vAlpha * clamp(fromEdge, 0., 1.);
    gl_FragColor = vec4(col * a2, a2);
    return;
  }
  if (vRed > 7.5) {
    // a holding's border: dash, dot (lengths in hyperbolic units)
    float t = fract(vDist / .09);
    if (!(t < .52 || (t > .66 && t < .74))) discard;
    gl_FragColor = vec4(ink * a * .9, a * .9);
    return;
  }
  if (vRed > 2.5 && vRed < 4.5) {
    // roads: dashes; sea routes: shorter dashes (lengths in hyperbolic units)
    float period = vRed > 3.5 ? .035 : .028;
    if (fract(vDist / period) > (vRed > 3.5 ? .45 : .62)) discard;
  }
  if (vRed > 1.5 && vRed < 2.5 && vWidth > 6.) {
    // a wide river: two inked banks, pale water, a broken flow streak down the middle
    float bank = 1. - smoothstep(1.1, 2.1, fromEdge);
    float streak = (1. - smoothstep(.35, .9, abs(vSide) * vWidth * .5)) * step(.3, vAlong) * step(vAlong, .72) * .45;
    a = vAlpha * max(max(bank, streak), .07);
  }
  gl_FragColor = vec4(c * a, a);
}`
  const SPRITE_V = `${COMMON}
attribute vec2 c; attribute vec2 corner; attribute vec4 uv; attribute vec3 anchorSize;
varying vec2 vUv;
void main(){
  vec2 C = mob(c);
  float s = anchorSize.z * unit(C);
  vec2 cs = px(C);
  if (s < 2.5 || cs.x < -s || cs.y < -s || cs.x > screen.x + s || cs.y > screen.y + s * 2.) {
    gl_Position = vec4(2., 2., 2., 1.); return;
  }
  vec2 pos = cs + (corner - anchorSize.xy) * s;
  vUv = mix(uv.xy, uv.zw, corner);
  gl_Position = clip(pos, clamp(.9 - cs.y / screen.y * 1.8, -.99, .99));
}`
  const SPRITE_F = `
precision highp float;
uniform sampler2D atlas;
varying vec2 vUv;
void main(){
  vec4 t = texture2D(atlas, vUv);
  if (t.a < .3) discard;
  gl_FragColor = t;
}`

  // name ribbons: placed under their place, sized for reading, shown once the place is big enough
  const LABEL_V = `${COMMON}
attribute vec2 c; attribute vec2 corner; attribute vec4 uv; attribute vec2 sizes; // glyph size (hyperbolic), native width (px)
attribute float style;   // 0 a ribbon under a notable place, 1 a small name by a dot
varying vec2 vUv; varying float vA;
uniform float dpr;
void main(){
  vec2 C = mob(c);
  vec2 cs = px(C);
  float aspect = (uv.w - uv.y) / (uv.z - uv.x);
  vec2 pos;
  {
    float glyph = sizes.x * unit(C);
    vA = smoothstep(34., 50., glyph);
    if (cs.x < -400. || cs.y < -200. || cs.x > screen.x + 400. || cs.y > screen.y + 400.) vA = 0.;
    if (style > .5) {
      float w = sizes.y * .5 * dpr;
      pos = cs + vec2(corner.x * w + glyph * .12, (corner.y - .62) * w * aspect);   // beside the dot
    } else {
      float w = sizes.y * .5 * dpr * clamp(glyph / 70., .75, 1.15);
      pos = cs + vec2((corner.x - .5) * w, corner.y * w * aspect + glyph * .08);   // just below the place
    }
  }
  if (vA <= 0.) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vUv = mix(uv.xy, uv.zw, corner);
  gl_Position = clip(pos, 0.);
}`
  const LABEL_F = `
precision highp float;
uniform sampler2D atlas;
varying vec2 vUv; varying float vA;
void main(){ gl_FragColor = texture2D(atlas, vUv) * vA; }`

  // the Tree's leaf land: triangles of the canopy, filled
  const FILL_V = `${COMMON}
attribute vec2 p;
void main(){ gl_Position = clip(px(mob(p)), 0.); }`
  const FILL_F = `
precision highp float;
uniform vec3 colour;
void main(){ gl_FragColor = vec4(colour, 1.); }`

  // the haze under the Tree: a full-screen pass that mutes the land only where the Tree's
  // foliage reaches (reach: its distance from the trunk in each direction), fading off softly
  const HAZE_V = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0., 1.); }`
  const HAZE_F = `${COMMON}
uniform vec4 inv;          // the view's inverse: a = inv.xy, b = inv.zw
uniform float reach[${72}];
uniform vec4 haze;         // colour and strength
vec2 back(vec2 z){ return cdiv(cmul(inv.xy, z) + inv.zw, cmul(vec2(inv.z, -inv.w), z) + vec2(inv.x, -inv.y)); }
float reachAt(float t){
  float f = t * 72.;
  int i = int(floor(f));
  float a = 0., b = 0.;
  for (int k = 0; k < 72; k++) {
    if (k == i) a = reach[k];
    if (k == (i + 1) - ((i + 1) / 72) * 72) b = reach[k];
  }
  return mix(a, b, fract(f));
}
void main(){
  vec2 s = vec2(gl_FragCoord.x, screen.y - gl_FragCoord.y);
  vec2 z = unproj((s - screen.xy * .5) / (screen.z * screen.w));
  if (dot(z, z) >= 1.) discard;
  vec2 w = back(z);
  float r = length(w);
  float d = log((1. + min(r, .999999)) / (1. - min(r, .999999)));   // 2 atanh r
  float theta = mod(atan(w.x, -w.y) / 6.2831853, 1.);
  float edge = reachAt(theta);
  float a = haze.a * (1. - smoothstep(edge - .05, edge + .22, d));
  gl_FragColor = vec4(haze.rgb * a, a);
}`

  // the regions layer: each land of the peoples filled with its colour, see-through
  const REG_V = `${COMMON}
attribute vec2 p; attribute vec3 col;
varying vec3 vC;
void main(){ vC = col; gl_Position = clip(px(mob(p)), 0.); }`
  const REG_F = `
precision highp float;
varying vec3 vC;
uniform float alpha;
void main(){ gl_FragColor = vec4(vC * alpha, alpha); }`

  // the land: a triangle mesh coloured by biome, mottled like old paper
  const LAND_V = `${COMMON}
attribute vec2 p; attribute vec3 col; attribute float tex;
uniform vec2 offs;   // a screen offset, for the canopy's shadow on the ground
varying vec3 vC; varying vec2 vP; varying float vTex; varying float vPpu;
void main(){
  vC = col; vP = p;                            // the disk point: the textures are built on it below
  vTex = tex;
  vPpu = unit(mob(p));                         // screen pixels per hyperbolic unit here
  gl_Position = clip(px(mob(p)) + offs, 0.);
}`
  const LAND_F = `
precision highp float;
varying vec3 vC; varying vec2 vP; varying float vTex; varying float vPpu;
uniform float shade;   // above 0: draw only a translucent shadow
uniform float leafy;   // 1 for the Tree's foliage: tufts of needles over the colour
vec2 hash2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// rounded clumps (cellular noise): light on each clump's north-west side, dark gaps between
float clumps(vec2 q){
  vec2 i = floor(q), f = fract(q);
  float d1 = 9., d2 = 9.; vec2 best = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + hash2(i + o) * .8 + .1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; best = r; } else if (d < d2) d2 = d;
  }
  float e = sqrt(d1);
  float hl = 1. - smoothstep(0., .42, length(best - vec2(.16, .16)));   // the lit side of a tuft
  float gap = 1. - smoothstep(.0, .3, sqrt(d2) - e);
  return .82 + .3 * hl - .16 * smoothstep(.25, .6, e) - .12 * gap;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
// the turf of each holding of the marsh round the Tree: what the ground is like there, in tone
// only (never drawn strokes). Returns a factor on the colour.
float hash1(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
float cells(vec2 q, out float edge){
  vec2 i = floor(q), f = fract(q);
  float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + vec2(hash1(i + o), hash1(i + o + 7.3)) * .8 + .1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  edge = sqrt(d2) - sqrt(d1);
  return sqrt(d1);
}
float turf(float id, vec2 q){
  float e;
  if (id < .5) return 1.;
  if (id < 1.5) return 1. + .05 * (noise(q * 6.) - .5) + .03 * (noise(q * 17.) - .5);      // trodden earth
  if (id < 2.5) return 1. + .08 * (smoothstep(.35, .65, noise(q * 2.4)) - .5) + .03 * (noise(q * 11.) - .5);   // leaf litter
  if (id < 3.5) {                                                                           // mud with fine cracks
    cells(q * 1.6, e);
    return 1. + .02 * (noise(q * 3.) - .5) - .07 * (1. - smoothstep(.02, .07, e));
  }
  if (id < 4.5) {                                                                           // cushions of wet moss
    float d = cells(q * 2.4, e);
    return 1. + .06 * (.5 - d) - .04 * (1. - smoothstep(.05, .2, e));
  }
  if (id < 5.5) {                                                                           // reed turf: short fibres
    vec2 r = vec2(q.x * .9 + q.y * .45, -q.x * .45 + q.y * .9);
    return 1. + .07 * (noise(vec2(r.x * 10., r.y * 1.5)) - .5) + .03 * (noise(q * 5.) - .5);
  }
  if (id < 7.5) {                                                                           // dry tussocks
    float d = cells(q * (id < 6.5 ? 1.8 : 2.2), e);
    return 1. + .07 * (smoothstep(.45, .1, d) - .3) + .03 * (noise(q * 14.) - .5);
  }
  return 1. - .06 * smoothstep(.4, .7, noise(q * 1.3)) + .05 * (noise(vec2(q.x * 12., q.y * 2.)) - .5);   // dark fibrous peat
}
void main(){
  if (shade > 0.) { gl_FragColor = vec4(vec3(.17, .12, .06) * shade, shade); return; }
  // Texture coordinates of even size in hyperbolic units, everywhere: the disk point is
  // conformal (shapes keep their proportions) but the plane's scale grows towards the rim, by
  // lambda = 2 / (1 - |p|^2). So the disk point is scaled by the two powers of two either side
  // of lambda, and the two textures blended (weights keeping the contrast even), so the
  // mottling neither stretches into bands at the rim nor changes its size.
  float lam = 2. / max(1. - dot(vP, vP), 1e-5);
  float L = log2(lam);
  float k0 = floor(L);
  float t = L - k0;
  vec2 Q0 = vP * exp2(k0) + vec2(mod(k0, 7.) * 17.31, mod(k0, 5.) * 9.73);
  vec2 Q1 = vP * exp2(k0 + 1.) + vec2(mod(k0 + 1., 7.) * 17.31, mod(k0 + 1., 5.) * 9.73);
  float w0 = cos(t * 1.5708), w1 = sin(t * 1.5708);
  float m0 = noise(Q0 * 3.) * .55 + noise(Q0 * 11.) * .3;
  float m1 = noise(Q1 * 3.) * .55 + noise(Q1 * 11.) * .3;
  float m = .425 + (m0 - .425) * w0 + (m1 - .425) * w1 + noise(gl_FragCoord.xy / 3.) * .15;
  vec3 c = vC * (.9 + .14 * m);
  // the holding's own parchment, fading out where it would be too fine to see
  float scale = .12;
  float fade = smoothstep(4., 9., scale * vPpu / 4.);
  float id = floor(vTex + .5);
  float tf = 1. + (turf(id, Q0 / scale) - 1.) * w0 + (turf(id, Q1 / scale) - 1.) * w1;
  c *= mix(1., tf, fade);
  if (leafy > .5) {
    // a hint of tufts of needles, in keeping with the map
    float cl = .9 + (clumps(Q0 * 40.) - .9) * w0 + (clumps(Q1 * 40.) - .9) * w1;
    c *= .9 + .1 * cl;
  }
  gl_FragColor = vec4(c, 1.);
}`

  const data = Promise.all([
    fetch(base + "world.json").then((r) => r.json()),
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.src = base + "atlas.png"
    }),
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = base + "labels.png"
    }),
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = base + "tree.png"
    }),
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = base + "places.png"
    }),
    fetch(base + "land.bin")
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
    fetch(base + "canopy.bin")
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
    fetch(base + "regions.bin")
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null),
  ])

  function setup(host) {
    if (host.__ddMap) return
    host.__ddMap = true
    const canvas = document.createElement("canvas")
    host.appendChild(canvas)
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, stencil: true })
    if (!gl) {
      host.textContent = "Для карты нужен WebGL."
      return
    }
    const program = (vs, fs) => {
      const p = gl.createProgram()
      for (const [type, src] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ]) {
        const s = gl.createShader(type)
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
        gl.attachShader(p, s)
      }
      gl.linkProgram(p)
      return p
    }
    const bg = program(BG_V, BG_F)
    const lines = program(LINE_V, LINE_F)
    const sprites = program(SPRITE_V, SPRITE_F)
    const labelProg = program(LABEL_V, LABEL_F)
    const fillProg = program(FILL_V, FILL_F)
    const landProg = program(LAND_V, LAND_F)
    const regProg = program(REG_V, REG_F)
    const hazeProg = program(HAZE_V, HAZE_F)
    let treeHaze = null
    let landMesh = null
    let regionsMesh = null // the lands of the peoples, filled in their colours (the regions layer)
    let regionsOn = false
    try {
      regionsOn = localStorage.getItem("dd-map-regions") === "1"
    } catch {}
    let riverLines = null
    let placeSprites = null
    let canopyMesh = null
    let placesTex = null
    let treeFill = null
    let treeOn = false
    try {
      treeOn = localStorage.getItem("dd-map-tree") === "1"
    } catch {}
    let treeLabelBuf = null
    let underLabelBuf = null
    let underLabelCount = 0
    let treeLabelCount = 0
    let treeRegions = []
    const LABEL_LAYOUT = [["c", 2], ["corner", 2], ["uv", 4], ["sizes", 2], ["style", 1]]
    let labelBuf = null
    let labelCount = 0
    let atlasTex = null
    let labelTex = null

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const LINE_LAYOUT = [["p", 2], ["q", 2], ["corner", 2], ["style", 3], ["along", 2]]
    const SPRITE_LAYOUT = [["c", 2], ["corner", 2], ["uv", 4], ["anchorSize", 3]]
    let lineBuf = null
    let lineCount = 0
    let spriteBuf = null
    let treeLines = null
    let treeBranches = null
    let treeSprites = null
    let treeTex = null
    let regions = []
    let lands = [] // the biomes' lands: not drawn, only named in the tip under a realm
    let notes = [] // places with a note of their own, read when the pointer rests on them
    let regionLines = null
    let hovered = null
    let spriteCount = 0
    let limits = [3, 4, 4.5]
    const bind = (prog, buf, layout) => {
      for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      const stride = layout.reduce((s, [, n]) => s + n, 0) * 4
      let off = 0
      for (const [name, n] of layout) {
        const loc = gl.getAttribLocation(prog, name)
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc)
          gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off)
        }
        off += n * 4
      }
    }

    let view = { a: [1, 0], b: [0, 0] }
    let zoom = ZOOM.start
    // the projection, as in the shaders: weights of the disk, the equal-area and the equidistant plane
    let proj_ = 0
    try {
      proj_ = Number(localStorage.getItem("dd-map-proj")) || 0
      if (!(proj_ >= 0 && proj_ <= 2)) proj_ = 0
    } catch {}
    let projw = [0, 1, 2].map((i) => (i === proj_ ? 1 : 0))
    const radial = (r) => {
      r = Math.min(r, 1 - 1e-12)
      return projw[0] * r + (projw[1] * r) / Math.sqrt(1 - r * r) + projw[2] * Math.atanh(r)
    }
    const proj = (z) => {
      const r = Math.hypot(z[0], z[1])
      if (r < 1e-12) return z
      const k = radial(r) / r
      return [z[0] * k, z[1] * k]
    }
    const unproj = (q) => {
      const L = Math.hypot(q[0], q[1])
      if (projw[0] > 0.9999 || L < 1e-12) return q
      let lo = 0
      let hi = 1
      for (let i = 0; i < 48; i++) {
        const r = (lo + hi) / 2
        if (radial(r) < L) lo = r
        else hi = r
      }
      return [(q[0] / L) * lo, (q[1] / L) * lo]
    }
    const zoomMin = () => projw.reduce((s, w, i) => s + w * ZOOM.mins[i], 0)
    let ready = false
    let queued = false

    const uniforms = (prog) => {
      gl.uniform3f(gl.getUniformLocation(prog, "bark"), ...BARK_GROUND)
      gl.uniform1f(gl.getUniformLocation(prog, "rounded"), 0)
      gl.uniform4f(gl.getUniformLocation(prog, "m"), view.a[0], view.a[1], view.b[0], view.b[1])
      gl.uniform3f(gl.getUniformLocation(prog, "projw"), ...projw)
      gl.uniform4f(
        gl.getUniformLocation(prog, "screen"),
        canvas.width,
        canvas.height,
        zoom,
        Math.min(canvas.width, canvas.height) / 2,
      )
    }
    // the Great Tree lies in the land's own plane and moves with it; only its bark differs
    const treeUniforms = (prog) => {
      uniforms(prog)
      gl.uniform3f(gl.getUniformLocation(prog, "bark"), ...BARK_TREE)
      gl.uniform1f(gl.getUniformLocation(prog, "rounded"), 1)
    }
    const draw = () => {
      queued = false
      if (!canvas.isConnected) return
      const w = Math.round(canvas.clientWidth * devicePixelRatio)
      const h = Math.round(canvas.clientHeight * devicePixelRatio)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.BLEND)
      gl.useProgram(bg)
      uniforms(bg)
      gl.uniform3f(gl.getUniformLocation(bg, "limits"), ...limits)
      bind(bg, quad, [["v", 2]])
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!ready) return
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(lines)
      uniforms(lines)
      gl.uniform3f(gl.getUniformLocation(lines, "ink"), ...INK)
      gl.uniform3f(gl.getUniformLocation(lines, "red"), ...RED)
      gl.uniform3f(gl.getUniformLocation(lines, "bank"), ...BANK)
      gl.uniform3f(gl.getUniformLocation(lines, "water"), ...WATER)
      const pass = gl.getUniformLocation(lines, "pass")
      gl.uniform1f(pass, -1)
      if (landMesh) {
        // the land marks the stencil, so river banks stop at the shore and only water runs on
        gl.clearStencil(0)
        gl.clear(gl.STENCIL_BUFFER_BIT)
        gl.enable(gl.STENCIL_TEST)
        gl.stencilFunc(gl.ALWAYS, 1, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
        gl.useProgram(landProg)
        uniforms(landProg)
        gl.uniform2f(gl.getUniformLocation(landProg, "offs"), 0, 0)
        gl.uniform1f(gl.getUniformLocation(landProg, "shade"), 0)
        gl.uniform1f(gl.getUniformLocation(landProg, "leafy"), 0)
        bind(landProg, landMesh.buf, [["p", 2], ["col", 3], ["tex", 1]])
        gl.drawArrays(gl.TRIANGLES, 0, landMesh.count)
        gl.disable(gl.STENCIL_TEST)
        if (regionsOn && regionsMesh) {
          gl.useProgram(regProg)
          uniforms(regProg)
          gl.uniform1f(gl.getUniformLocation(regProg, "alpha"), 0.5)
          bind(regProg, regionsMesh.buf, [["p", 2], ["col", 3], ["tex", 1]])
          gl.drawArrays(gl.TRIANGLES, 0, regionsMesh.count)
        }
        gl.useProgram(lines)
      }
      bind(lines, lineBuf, LINE_LAYOUT)
      gl.drawArrays(gl.TRIANGLES, 0, lineCount)
      if (riverLines) {
        bind(lines, riverLines.buf, LINE_LAYOUT)
        if (landMesh) {
          gl.enable(gl.STENCIL_TEST)
          gl.stencilFunc(gl.EQUAL, 1, 0xff)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
        }
        gl.uniform1f(pass, 0)
        gl.drawArrays(gl.TRIANGLES, 0, riverLines.count)
        gl.disable(gl.STENCIL_TEST)
        gl.uniform1f(pass, 1)
        gl.drawArrays(gl.TRIANGLES, 0, riverLines.count)
        gl.uniform1f(pass, -1)
      }
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.useProgram(sprites)
      uniforms(sprites)
      gl.bindTexture(gl.TEXTURE_2D, atlasTex)
      bind(sprites, spriteBuf, SPRITE_LAYOUT)
      gl.drawArrays(gl.TRIANGLES, 0, spriteCount)
      if (placeSprites) {
        // settlements and great places, drawn large in their own atlas; the depth buffer is shared
        gl.bindTexture(gl.TEXTURE_2D, placesTex)
        bind(sprites, placeSprites.buf, SPRITE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, placeSprites.count)
      }
      const drawLabels = (buf, count, tree) => {
        if (!labelTex || !count) return
        gl.useProgram(labelProg)
        if (tree) treeUniforms(labelProg)
        else uniforms(labelProg)
        gl.uniform1f(gl.getUniformLocation(labelProg, "dpr"), devicePixelRatio)
        gl.bindTexture(gl.TEXTURE_2D, labelTex)
        bind(labelProg, buf, LABEL_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, count)
      }
      gl.disable(gl.DEPTH_TEST)
      // the ground's names lie on the ground, under the Tree
      drawLabels(labelBuf, labelCount, false)
      drawLabels(underLabelBuf, underLabelCount, false)
      if (hovered && regionLines && hovered.set !== "tree") {
        gl.useProgram(lines)
        uniforms(lines)
        bind(lines, regionLines.buf, LINE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, hovered.first, hovered.count)
      }
      if (treeOn && treeLines) {
        // the Great Tree's own map over the land: a haze over the land beneath it, the clouds'
        // shadow on the ground, its boughs, the clouds of leaves, their lines, then its glyphs
        // and names
        if (treeHaze) {
          gl.useProgram(hazeProg)
          uniforms(hazeProg)
          const iv = inverse(view)
          gl.uniform4f(gl.getUniformLocation(hazeProg, "inv"), iv.a[0], iv.a[1], iv.b[0], iv.b[1])
          gl.uniform1fv(gl.getUniformLocation(hazeProg, "reach"), treeHaze)
          gl.uniform4f(gl.getUniformLocation(hazeProg, "haze"), 0.93, 0.89, 0.79, 0.55)
          for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i)
          gl.bindBuffer(gl.ARRAY_BUFFER, quad)
          const loc = gl.getAttribLocation(hazeProg, "p")
          gl.enableVertexAttribArray(loc)
          gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
        if (canopyMesh) {
          gl.useProgram(landProg)
          treeUniforms(landProg)
          gl.uniform2f(gl.getUniformLocation(landProg, "offs"), 6 * devicePixelRatio, 8 * devicePixelRatio)
          gl.uniform1f(gl.getUniformLocation(landProg, "shade"), 0.28)
          bind(landProg, canopyMesh.buf, [["p", 2], ["col", 3], ["tex", 1]])
          gl.drawArrays(gl.TRIANGLES, 0, canopyMesh.count)
        }
        gl.useProgram(lines)
        treeUniforms(lines)
        gl.uniform1f(gl.getUniformLocation(lines, "pass"), -1)
        bind(lines, treeBranches.buf, LINE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, treeBranches.count)
        if (canopyMesh) {
          gl.useProgram(landProg)
          treeUniforms(landProg)
          gl.uniform2f(gl.getUniformLocation(landProg, "offs"), 0, 0)
          gl.uniform1f(gl.getUniformLocation(landProg, "shade"), 0)
          gl.uniform1f(gl.getUniformLocation(landProg, "leafy"), 1)
          bind(landProg, canopyMesh.buf, [["p", 2], ["col", 3], ["tex", 1]])
          gl.drawArrays(gl.TRIANGLES, 0, canopyMesh.count)
        }
        gl.useProgram(lines)
        treeUniforms(lines)
        bind(lines, treeLines.buf, LINE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, treeLines.count)
        gl.useProgram(sprites)
        treeUniforms(sprites)
        gl.bindTexture(gl.TEXTURE_2D, treeTex)
        bind(sprites, treeSprites.buf, SPRITE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, treeSprites.count)
        if (hovered && regionLines && hovered.set === "tree") {
          gl.useProgram(lines)
          treeUniforms(lines)
          bind(lines, regionLines.buf, LINE_LAYOUT)
          gl.drawArrays(gl.TRIANGLES, hovered.first, hovered.count)
        }
        drawLabels(treeLabelBuf, treeLabelCount, true)
      }
    }
    const redraw = () => {
      if (!queued) {
        queued = true
        requestAnimationFrame(draw)
      }
    }

    // for checking the map by script: look at disk point (x, y) at a given zoom, drawn at once
    host.__ddLook = (x, y, z) => {
      view = carry([x, y], [0, 0])
      zoom = Math.min(ZOOM.max, Math.max(zoomMin(), z))
      draw()
    }

    const texture = (img) => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return tex
    }
    data.then(([world, img, labelImg, treeImg, placesImg, landBin, canopyBin, regionsBin]) => {
      limits = [world.limits.coast, world.limits.ocean, world.limits.ice]
      const CORNERS = [
        [0, -1],
        [1, -1],
        [0, 1],
        [0, 1],
        [1, -1],
        [1, 1],
      ]
      const QUAD = [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 1],
        [1, 0],
        [1, 1],
      ]
      const STYLE = { rhumb: 1, river: 2, road: 3, route: 4, branch: 5, region: 6, border: 8 }
      // lines: six vertices per segment, with the run of hyperbolic length for dashes
      const buildLines = (list) => {
        let segs = 0
        for (const l of list) segs += l.pts.length / 2 - 1
        const lv = new Float32Array(segs * 6 * 11)
        let o = 0
        for (const l of list) {
          const pts = l.pts
          const style = STYLE[l.k] || 0
          let run = 0
          for (let i = 0; i + 3 < pts.length; i += 2) {
            const rel = apply(inverse(shift([pts[i], pts[i + 1]])), [pts[i + 2], pts[i + 3]])
            const len = 2 * Math.atanh(Math.min(0.999999, Math.hypot(rel[0], rel[1])))
            for (const [t, sd] of CORNERS) {
              lv.set([pts[i], pts[i + 1], pts[i + 2], pts[i + 3], t, sd, l.w, l.a, style, run, run + len], o)
              o += 11
            }
            run += len
          }
        }
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, lv, gl.STATIC_DRAW)
        return { buf, count: segs * 6 }
      }
      // glyphs: six vertices each, in the order of their kinds
      const buildSprites = (dict, atlas = world.atlas) => {
        let n = 0
        for (const k in dict) n += dict[k].length / 3
        const sv = new Float32Array(n * 6 * 11)
        let o = 0
        for (const kind in dict) {
          const cell = atlas[kind]
          if (!cell) continue
          const arr = dict[kind]
          for (let i = 0; i < arr.length; i += 3) {
            for (const [cx, cy] of QUAD) {
              sv.set([arr[i], arr[i + 1], cx, cy, cell[0], cell[1], cell[2], cell[3], cell[4], cell[5], arr[i + 2]], o)
              o += 11
            }
          }
        }
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, sv.subarray(0, o), gl.STATIC_DRAW)
        return { buf, count: o / 11 }
      }
      // the holdings' borders are in the data but hidden for now (SHOW_BORDERS)
      ;({ buf: lineBuf, count: lineCount } = buildLines(
        world.lines.filter((l) => l.k !== "river" && (SHOW_BORDERS || l.k !== "border")),
      ))
      riverLines = buildLines(world.lines.filter((l) => l.k === "river"))
      // coloured meshes: uint32 vertices, uint32 triangles, float32 xy, uint8 rgb, uint32 indices
      const readMesh = (bin) => {
        const [nv, nt] = new Uint32Array(bin, 0, 2)
        const xy = new Float32Array(bin, 8, nv * 2)
        const rgb = new Uint8Array(bin, 8 + nv * 8, nv * 3)
        const off = 8 + nv * 11
        const idx = new Uint32Array(bin.slice(off, off + nt * 12))
        const texOff = off + nt * 12
        const tex = bin.byteLength >= texOff + nt ? new Uint8Array(bin, texOff, nt) : null
        const out = new Float32Array(nt * 3 * 6)
        for (let i = 0; i < nt * 3; i++) {
          const v = idx[i]
          out.set([xy[v * 2], xy[v * 2 + 1], rgb[v * 3] / 255, rgb[v * 3 + 1] / 255, rgb[v * 3 + 2] / 255, tex ? tex[(i / 3) | 0] : 0], i * 6)
        }
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW)
        return { buf, count: nt * 3 }
      }
      if (canopyBin) canopyMesh = readMesh(canopyBin)
      if (landBin) landMesh = readMesh(landBin)
      if (regionsBin) regionsMesh = readMesh(regionsBin)
      ;({ buf: spriteBuf, count: spriteCount } = buildSprites(world.sprites))
      if (world.places && placesImg) {
        placeSprites = buildSprites(world.sprites, world.places)
        placesTex = texture(placesImg)
      }
      const regionSets = []
      for (const [set, src] of [["ground", world.regions], ["tree", world.tree && world.tree.regions]]) {
        if (src) regionSets.push([set, src])
      }
      if (regionSets.length) {
        const list = []
        const all = regionSets.flatMap(([set, src]) => src.map((r) => ({ ...r, set })))
        regions = all.map((r) => {
          const rings = r.rings.map((flat) => {
            const pts = []
            for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]])
            return pts
          })
          let area = 0
          let box = [1, 1, -1, -1]
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const [x1, y1] = ring[i]
              const [x2, y2] = ring[(i + 1) % ring.length]
              area += x1 * y2 - x2 * y1
              box = [Math.min(box[0], x1), Math.min(box[1], y1), Math.max(box[2], x1), Math.max(box[3], y1)]
            }
          }
          const start = list.length
          for (const flat of r.rings) {
            list.push({ w: 0.02, a: 0.16, k: "region", pts: flat })
            list.push({ w: 0.0035, a: 0.8, k: "region", pts: flat })
          }
          return { name: r.name, kind: r.kind, set: r.set, rings, area: Math.abs(area) / 2, box, from: start, to: list.length }
        })
        // vertex offsets of each region's lines inside the shared buffer
        let v = 0
        const offsets = list.map((l) => {
          const o = v
          v += (l.pts.length / 2 - 1) * 6
          return o
        })
        offsets.push(v)
        for (const r of regions) {
          r.first = offsets[r.from]
          r.count = offsets[r.to] - offsets[r.from]
        }
        regionLines = buildLines(list)
      }
      notes = world.notes || []
      lands = (world.lands || []).map((r) => {
        const rings = r.rings.map((flat) => {
          const pts = []
          for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]])
          return pts
        })
        let box = [1, 1, -1, -1]
        for (const ring of rings) for (const [x, y] of ring) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
        return { name: r.name, kind: r.kind, rings, box }
      })
      if (world.tree && world.tree.fill) {
        const f = new Float32Array(world.tree.fill)
        const buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW)
        treeFill = { buf, count: f.length / 2 }
      }
      if (world.tree) {
        treeBranches = buildLines(world.tree.lines.filter((l) => l.k === "branch"))
        treeLines = buildLines(world.tree.lines.filter((l) => l.k !== "branch"))
        treeSprites = buildSprites(world.tree.sprites, world.tree.atlas || world.atlas)
        if (world.tree.haze && world.tree.haze.length === 72) treeHaze = new Float32Array(world.tree.haze)
      }

      atlasTex = texture(img)
      treeTex = treeImg ? texture(treeImg) : atlasTex
      if (labelImg && world.labels) {
        const items = world.labels.items
        const cells = world.labels.cells
        const stride = world.labels.stride || 5
        const make = (layer) => {
          const out = []
          for (let i = 0; i < items.length; i += stride) {
            if (items[i + 4] !== layer) continue
            const cell = cells["lbl" + items[i + 3]]
            const style = stride > 5 ? items[i + 5] : 0
            const nativeW = (cell[2] - cell[0]) * labelImg.width
            for (const [cx, cy] of QUAD)
              out.push(items[i], items[i + 1], cx, cy, cell[0], cell[1], cell[2], cell[3], items[i + 2], nativeW, style)
          }
          const buf = gl.createBuffer()
          gl.bindBuffer(gl.ARRAY_BUFFER, buf)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW)
          return { buf, count: out.length / 11 }
        }
        ;({ buf: labelBuf, count: labelCount } = make(0))
        ;({ buf: treeLabelBuf, count: treeLabelCount } = make(1))
        ;({ buf: underLabelBuf, count: underLabelCount } = make(2))
        labelTex = texture(labelImg)
      }
      ready = true
      redraw()
    })
    new ResizeObserver(redraw).observe(canvas)
    redraw()

    // ---- interaction
    const toDisk = (x, y, z = zoom) => {
      const r = canvas.getBoundingClientRect()
      const s = Math.min(r.width, r.height) / 2
      return clampDisk(unproj([(x - r.left - r.width / 2) / s / z, (y - r.top - r.height / 2) / s / z]))
    }
    // the view centre may not go farther than REACH from the Tree; at the limit it slides along
    const R_REACH = Math.tanh(REACH / 2)
    // The view is always a pure shift of the plane, never turned: the point c of the disk is
    // carried to the middle of the screen without rotation, so north stays up there. (Shifts
    // composed on the hyperbolic plane turn it; keeping only the shift undoes that.)
    const centred = (c) => shift([-c[0], -c[1]])
    const setCentre = (c) => {
      tip.style.opacity = 0 // the map moves under the tip: it goes
      const l = Math.hypot(c[0], c[1])
      if (l > R_REACH) c = [(c[0] / l) * R_REACH, (c[1] / l) * R_REACH]
      const next = centred(c)
      const moved = Math.hypot(next.b[0] - view.b[0], next.b[1] - view.b[1]) + Math.hypot(next.a[0] - view.a[0], next.a[1] - view.a[1])
      view = next
      redraw()
      return moved > 1e-7
    }
    // the centre that puts the plane's point w at the view's point q with no turn: solves
    // w = (q + c) / (conj(c) q + 1) for c
    const centreFor = (w, q) => {
      const a = mul(w, q)
      const b = [w[0] - q[0], w[1] - q[1]]
      const ab = mul(a, conj(b))
      const k = 1 - (a[0] ** 2 + a[1] ** 2)
      return [(b[0] + ab[0]) / k, (b[1] + ab[1]) / k]
    }
    const move = (mv) => setCentre(apply(inverse(compose(mv, view)), [0, 0]))
    // zoom about a screen point, keeping the map point under it in place
    const zoomAt = (x, y, factor) => {
      const w = apply(inverse(view), toDisk(x, y)) // the point under the pointer stays there
      const nz = Math.min(ZOOM.max, Math.max(zoomMin(), zoom * factor))
      if (nz === zoom) return
      zoom = nz
      setCentre(centreFor(w, toDisk(x, y)))
    }

    // regions: hidden until the pointer rests on one; then the smallest region under it
    // lights up and its name shows beside the pointer
    const tip = document.createElement("div")
    tip.className = "dd-hypermap-tip"
    host.appendChild(tip)
    const inside = (ring, x, y) => {
      let c = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
      return c
    }
    const regionsAt = (cx, cy) => {
      const [x, y] = apply(inverse(view), toDisk(cx, cy))
      const hit = regions
        .filter((r) => r.set === "ground" || treeOn)
        // even-odd over all of a region's rings, so its holes (lakes, or a land it surrounds) are not in it
        .filter((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3] && r.rings.reduce((c, ring) => c !== inside(ring, x, y), false))
        .sort((a, b) => a.area - b.area)
      // with the Tree shown, its regions lie on top of the land's
      return treeOn ? [...hit.filter((r) => r.set === "tree"), ...hit.filter((r) => r.set !== "tree")] : hit
    }
    const landAt = (cx, cy) => {
      const [x, y] = apply(inverse(view), toDisk(cx, cy))
      return lands.find((r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3] && r.rings.reduce((c, ring) => c !== inside(ring, x, y), false))
    }
    // the place under the pointer, if it has a note: within about its glyph's reach on screen
    const noteAt = (cx, cy) => {
      const [x0, y0, h] = half()
      let best = null
      let bd = 1e9
      for (const n of notes) {
        if (n.layer === 1 && !treeOn) continue
        // with the Tree shown, its places are read first
        if (best && best.layer === 1 && n.layer !== 1) continue
        const p0 = apply(view, [n.x, n.y])
        const l2 = p0[0] ** 2 + p0[1] ** 2
        if (l2 >= 1) continue
        const p = proj(p0)
        const sx = x0 + p[0] * zoom * h
        const sy = y0 + p[1] * zoom * h
        const reach = Math.max(14, 0.07 * (projw[0] * (1 - l2) + 1 - projw[0]) * 0.5 * zoom * h)
        const d = Math.hypot(cx - sx, cy - (sy - reach * 0.4))
        if (d < reach && (d < bd || (n.layer === 1 && best && best.layer !== 1))) {
          bd = d
          best = n
        }
      }
      return best
    }
    // the tip: like any tooltip, it shows only when the pointer has rested a moment, and goes
    // at once on any move, press, drag, wheel or leaving; regions are not lit up
    const TIP_DELAY = 500
    let tipTimer = 0
    const hideTip = () => {
      clearTimeout(tipTimer)
      tip.style.opacity = 0
    }
    const showTip = (x, y) => {
      if (pointers.size) return
      const r = canvas.getBoundingClientRect()
      const note = noteAt(x, y)
      if (note) {
        tip.innerHTML = `<b>${note.name}</b><span>${note.people}</span><p>${note.note}</p>`
      } else {
        const top = regionsAt(x, y)[0]
        if (!top) return
        // the realm and its people; below it, the land under the pointer
        const land = top.set === "ground" ? landAt(x, y) : null
        tip.innerHTML = `<b>${top.name}</b><span>${top.kind}</span>` + (land ? `<i>${land.name} · ${land.kind}</i>` : "")
      }
      tip.style.left = `${x - r.left + 14}px`
      tip.style.top = `${y - r.top + 14}px`
      tip.style.opacity = 1
    }
    canvas.addEventListener("pointermove", (e) => {
      hideTip()
      if (pointers.size || e.pointerType === "touch") return
      const x = e.clientX
      const y = e.clientY
      tipTimer = setTimeout(() => showTip(x, y), TIP_DELAY)
    })
    canvas.addEventListener("pointerleave", hideTip)
    canvas.addEventListener("pointerdown", hideTip)
    canvas.addEventListener("wheel", hideTip, { passive: true })

    const half = () => {
      const r = canvas.getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2, Math.min(r.width, r.height) / 2]
    }
    // for checking by script: the land's point under a screen point, and where it lies on screen
    host.__ddGroundAt = (x, y) => apply(inverse(view), toDisk(x, y))
    host.__ddGroundScreen = (w) => {
      const [cx, cy, h] = half()
      const p = proj(apply(view, w))
      return [cx + p[0] * zoom * h, cy + p[1] * zoom * h]
    }
    const pointers = new Map()
    let pinch = null
    let vel = [0, 0]
    let last = 0
    let glide = 0
    let grab = null // the plane's point held under the pointer while dragging
    let grabQ = null // and where on the view it is now
    const stop = () => cancelAnimationFrame(glide)
    canvas.addEventListener("pointerdown", (e) => {
      stop()
      pointers.set(e.pointerId, [e.clientX, e.clientY])
      grabQ = toDisk(e.clientX, e.clientY)
      grab = apply(inverse(view), grabQ)
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {}
      canvas.classList.add("dd-grabbing")
      vel = [0, 0]
      last = performance.now()
      if (pointers.size === 2) {
        const [p, q] = [...pointers.values()]
        pinch = Math.hypot(p[0] - q[0], p[1] - q[1])
      }
    })
    canvas.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = [e.clientX, e.clientY]
      if (pointers.size === 1) {
        const now = performance.now()
        const dt = Math.max(1, now - last)
        last = now
        const p = toDisk(...prev)
        const q = toDisk(...cur)
        vel = [((q[0] - p[0]) / dt) * 16, ((q[1] - p[1]) / dt) * 16]
        grabQ = q
        setCentre(centreFor(grab, q))
      }
      pointers.set(e.pointerId, cur)
      if (pointers.size === 2 && pinch) {
        const [p, q] = [...pointers.values()]
        const d = Math.hypot(p[0] - q[0], p[1] - q[1])
        zoomAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, d / pinch)
        pinch = d
      }
    })
    const release = (e) => {
      if (!pointers.has(e.pointerId)) return
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (pointers.size) {
        // one finger lifted from a pinch: the other holds the map from here
        const [rest] = [...pointers.values()]
        grabQ = toDisk(...rest)
        grab = apply(inverse(view), grabQ)
        return
      }
      canvas.classList.remove("dd-grabbing")
      if (performance.now() - last > 80) return
      // coast and slow down; the speed is capped so a flick cannot throw the map far
      let v = vel
      const l = Math.hypot(v[0], v[1])
      const cap = 0.02 / zoom
      if (l > cap) v = [(v[0] / l) * cap, (v[1] / l) * cap]
      const step = () => {
        v = [v[0] * 0.9, v[1] * 0.9]
        if (!grab || Math.hypot(v[0], v[1]) < 0.0002 / zoom) return
        grabQ = clampDisk([grabQ[0] + v[0], grabQ[1] + v[1]], 0.99)
        if (!setCentre(centreFor(grab, grabQ))) return
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    }
    canvas.addEventListener("pointerup", release)
    canvas.addEventListener("pointercancel", release)
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault()
        stop()
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)))
      },
      { passive: false },
    )
    canvas.addEventListener("dblclick", (e) => {
      stop()
      zoomAt(e.clientX, e.clientY, 1.6)
    })

    // buttons: zoom in, zoom out, back to the Tree
    const bar = document.createElement("div")
    bar.className = "dd-hypermap-bar"
    const button = (label, title, fn) => {
      const b = document.createElement("button")
      b.textContent = label
      b.title = title
      b.setAttribute("aria-label", title)
      b.addEventListener("click", (e) => {
        e.stopPropagation()
        stop()
        fn()
      })
      bar.appendChild(b)
    }
    const centre = () => {
      const r = canvas.getBoundingClientRect()
      return [r.left + r.width / 2, r.top + r.height / 2]
    }
    button("+", "Ближе", () => zoomAt(...centre(), 1.5))
    button("−", "Дальше", () => zoomAt(...centre(), 1 / 1.5))
    // full screen; where the browser refuses it (embedded views), fill the window instead
    const maximise = (on) => {
      host.classList.toggle("dd-hypermap-max", on)
      document.documentElement.classList.toggle("dd-hypermap-lock", on)
      redraw()
    }
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && host.classList.contains("dd-hypermap-max")) maximise(false)
    })
    button("⛶", "Во весь экран", () => {
      const doc = document
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        ;(doc.exitFullscreen || doc.webkitExitFullscreen).call(doc)
        return
      }
      if (host.classList.contains("dd-hypermap-max")) {
        maximise(false)
        return
      }
      const ask = host.requestFullscreen || host.webkitRequestFullscreen
      const tried = ask ? Promise.resolve(ask.call(host)) : Promise.reject()
      tried
        .then(() => new Promise((r) => setTimeout(r, 250)))
        .then(() => {
          if (!doc.fullscreenElement && !doc.webkitFullscreenElement) maximise(true)
        })
        .catch(() => maximise(true))
    })
    button("", "Древо: показать или скрыть", () => {
      treeOn = !treeOn
      try {
        localStorage.setItem("dd-map-tree", treeOn ? "1" : "0")
      } catch {}
      bar.querySelector('[data-tree]').classList.toggle("dd-on", treeOn)
      hovered = null
      redraw()
    })
    // a broad old tree: a crown of three clouds, a stout trunk spreading into roots
    bar.lastChild.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="display:block;margin:auto">' +
      '<path fill="currentColor" d="M12 2.2c2 0 3.6 1.2 4.1 2.9 2.2.1 3.9 1.8 3.9 3.9 0 1.1-.4 2-1.1 2.7.5.5.8 1.2.8 2 0 1.7-1.4 3-3.1 3-1 0-1.9-.4-2.4-1.1-.3.2-.6.3-1 .4V18c0 1.2.9 2.3 2.4 2.8l1.6.5v.9H6.8v-.9l1.6-.5C9.9 20.3 10.8 19.2 10.8 18v-1.9c-.4-.1-.7-.2-1-.4-.6.7-1.4 1.1-2.4 1.1-1.7 0-3.1-1.3-3.1-3 0-.8.3-1.5.8-2C4.4 11 4 10.1 4 9c0-2.1 1.7-3.8 3.9-3.9C8.4 3.4 10 2.2 12 2.2z"/>' +
      "</svg>"
    bar.lastChild.dataset.tree = "1"
    bar.lastChild.classList.toggle("dd-on", treeOn)
    // the regions layer: the lands of the peoples, each in its own colour
    button("", "Регионы: показать или скрыть", () => {
      regionsOn = !regionsOn
      try {
        localStorage.setItem("dd-map-regions", regionsOn ? "1" : "0")
      } catch {}
      bar.querySelector("[data-regions]").classList.toggle("dd-on", regionsOn)
      redraw()
    })
    bar.lastChild.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="display:block;margin:auto" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">' +
      '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>' +
      '<path d="M3 6l6-2v14l-6 2z" fill="currentColor" opacity=".35"/><path d="M15 6l6-2v14l-6 2z" fill="currentColor" opacity=".2"/>' +
      "</svg>"
    bar.lastChild.dataset.regions = "1"
    bar.lastChild.classList.toggle("dd-on", regionsOn)
    // the projection, in turn: the disk (the far lands shrink towards the rim), the equal-area
    // plane (every land at its true size: the middle smaller, the far lands opened out) and the
    // equidistant plane (every place at its true distance from the middle of the window). It
    // turns smoothly, keeping the land at the window's edge where it is.
    const PROJ = [
      ["Проекция: круг", '<circle cx="12" cy="12" r="9"/><path d="M12 3c-3.2 2.6-3.2 15.4 0 18M12 3c3.2 2.6 3.2 15.4 0 18M3.5 9h17M3.5 15h17"/>'],
      ["Проекция: равновеликая (площади верны)", '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>'],
      ["Проекция: равнопромежуточная (расстояния от центра верны)", '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/><path d="M12 12h9"/>'],
    ]
    let turning = 0
    const showProj = () => {
      const b = bar.querySelector("[data-proj]")
      const [title, icon] = PROJ[proj_]
      b.title = `${title}. Нажмите, чтобы сменить`
      b.setAttribute("aria-label", b.title)
      b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="display:block;margin:auto" fill="none" stroke="currentColor" stroke-width="1.6">${icon}</svg>`
      b.classList.toggle("dd-on", proj_ > 0)
    }
    button("", "Проекция", () => {
      cancelAnimationFrame(turning)
      const from = projw.slice()
      proj_ = (proj_ + 1) % 3
      const to = [0, 1, 2].map((i) => (i === proj_ ? 1 : 0))
      try {
        localStorage.setItem("dd-map-proj", String(proj_))
      } catch {}
      showProj()
      const edge = Math.hypot(...unproj([1 / zoom, 0])) // the disk point at the window's edge
      const t0 = performance.now()
      const step = (now) => {
        const k = Math.min(1, (now - t0) / 700)
        const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) ** 2
        projw = from.map((f, i) => f + (to[i] - f) * e)
        zoom = Math.min(ZOOM.max, Math.max(zoomMin(), 1 / radial(edge)))
        tip.style.opacity = 0
        redraw()
        if (k < 1) turning = requestAnimationFrame(step)
      }
      turning = requestAnimationFrame(step)
    })
    bar.lastChild.dataset.proj = "1"
    showProj()
    button("✦", "К Древу", () => {
      const step = () => {
        const tree = apply(view, [0, 0])
        zoom += (ZOOM.start - zoom) * 0.15
        if (Math.hypot(tree[0], tree[1]) < 0.001 && Math.abs(ZOOM.start - zoom) < 0.01) {
          zoom = ZOOM.start
          redraw()
          return
        }
        move(carry(tree, [tree[0] * 0.85, tree[1] * 0.85]))
        redraw()
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    })
    host.appendChild(bar)
    host.ddState = () => ({ view, zoom }) // for tests
    host.ddSet = (v, z) => {
      view = v
      zoom = z
      redraw()
    }
  }

  const scan = () => document.querySelectorAll(".dd-hypermap").forEach(setup)
  document.addEventListener("nav", scan)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan)
  else scan()
})()
