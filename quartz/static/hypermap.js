// Hyperbolic map of Morra, drawn natively on the hyperbolic plane (Poincaré disk, WebGL).
// The world comes from tools/art/hyper_world.py as data, not as a picture: lines (coast,
// rivers, sea ripples, rhumbs) are dense polylines of disk points, and every mountain, wood,
// lake or town is a glyph with a position and a size in hyperbolic units. Each frame the
// points are moved by the view's Möbius transform and glyphs are drawn upright at their local
// scale, so whatever you look at up close is undistorted; only the zoomed-out view bends.
// Dragging moves along the plane (the map turns as you go: that is the geometry), zoom
// magnifies the window onto the disk within limits, and the view cannot leave the coast far
// behind. Quartz swaps pages without reloading, so windows are set up on every "nav" event.
;(() => {
  if (window.__ddHypermap) return
  window.__ddHypermap = true
  const base = new URL("morra/", document.currentScript.src).href

  const ZOOM = { start: 3.4, min: 1.15, max: 17 } // window radius in the disk is 1 / zoom
  const REACH = 3.75 // farthest hyperbolic distance of the view centre from the Tree
  const INK = [0.169, 0.125, 0.086]
  const RED = [0.608, 0.227, 0.141]

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
vec2 cmul(vec2 p, vec2 q){ return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }
vec2 cdiv(vec2 p, vec2 q){ return vec2(p.x*q.x + p.y*q.y, p.y*q.x - p.x*q.y) / dot(q, q); }
vec2 mob(vec2 z){ return cdiv(cmul(m.xy, z) + m.zw, cmul(vec2(m.z, -m.w), z) + vec2(m.x, -m.y)); }
vec2 px(vec2 z){ return screen.xy * .5 + z * screen.z * screen.w; }
vec4 clip(vec2 p, float depth){ return vec4(p.x / screen.x * 2. - 1., 1. - p.y / screen.y * 2., depth, 1.); }
float unit(vec2 z){ return (1. - dot(z, z)) * .5 * screen.z * screen.w; }
`
  const BG_V = "attribute vec2 v; void main(){ gl_Position = vec4(v, 0.999, 1.); }"
  const BG_F = `${COMMON}
uniform vec3 limits;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, screen.y - gl_FragCoord.y);
  vec2 z = (p - screen.xy * .5) / (screen.z * screen.w);
  vec3 paper = vec3(.937, .886, .749);
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
  vAlpha = style.y * (river ? 1. : clamp(wpx / .7, .12, 1.));
  float full = shown + 1.;
  vec2 pos = px(X) + dir * (corner.x * 2. - 1.) * shown * .5 + n * corner.y * full * .5;
  vSide = corner.y; vWidth = full; vRed = style.z; vAlong = corner.x; vDist = mix(along.x, along.y, corner.x);
  gl_Position = clip(pos, 0.);
}`
  const LINE_F = `
precision highp float;
varying float vSide; varying float vWidth; varying float vAlpha; varying float vRed; varying float vAlong; varying float vDist;
uniform vec3 ink; uniform vec3 red;
void main(){
  float fromEdge = (1. - abs(vSide)) * vWidth * .5;
  float a = vAlpha * clamp(fromEdge, 0., 1.);
  vec3 c = (vRed > .5 && vRed < 1.5) || (vRed > 3.5 && vRed < 4.5) || vRed > 5.5 ? red : ink;
  if (vRed > 4.5 && vRed < 5.5) {
    // a limb of the Tree: inked bark edges, solid paper wood, grain along the limb
    float edge = 1. - smoothstep(1.2, 2.2, fromEdge);
    float grain = step(.8, fract(vDist / .035 + abs(vSide) * 2.)) * (1. - smoothstep(.0, .9, abs(abs(vSide) - .45))) * .5;
    vec3 wood = vec3(.93, .87, .74);
    vec3 col = mix(wood, ink, max(edge, grain));
    float a2 = vAlpha * clamp(fromEdge, 0., 1.);
    gl_FragColor = vec4(col * a2, a2);
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
attribute vec2 c; attribute vec2 corner; attribute vec4 uv; attribute vec2 sizes; // glyph size (hyperbolic), ribbon width (px)
varying vec2 vUv; varying float vA;
uniform float dpr;
void main(){
  vec2 C = mob(c);
  float glyph = sizes.x * unit(C);
  vA = smoothstep(34., 50., glyph);
  vec2 cs = px(C);
  if (vA <= 0. || cs.x < -400. || cs.y < -200. || cs.x > screen.x + 400. || cs.y > screen.y + 400.) {
    gl_Position = vec4(2., 2., 2., 1.); return;
  }
  float w = sizes.y * .5 * dpr * clamp(glyph / 70., .75, 1.15);
  float h = w * (uv.w - uv.y) / (uv.z - uv.x);
  vec2 pos = cs + vec2((corner.x - .5) * w, corner.y * h + glyph * .08);   // just below the place
  vUv = mix(uv.xy, uv.zw, corner);
  gl_Position = clip(pos, 0.);
}`
  const LABEL_F = `
precision highp float;
uniform sampler2D atlas;
varying vec2 vUv; varying float vA;
void main(){ gl_FragColor = texture2D(atlas, vUv) * vA; }`

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
  ])

  function setup(host) {
    if (host.__ddMap) return
    host.__ddMap = true
    const canvas = document.createElement("canvas")
    host.appendChild(canvas)
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false })
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
    const LABEL_LAYOUT = [["c", 2], ["corner", 2], ["uv", 4], ["sizes", 2]]
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
    let treeSprites = null
    let treeTex = null
    let regions = []
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
    let ready = false
    let queued = false

    const uniforms = (prog) => {
      gl.uniform4f(gl.getUniformLocation(prog, "m"), view.a[0], view.a[1], view.b[0], view.b[1])
      gl.uniform4f(
        gl.getUniformLocation(prog, "screen"),
        canvas.width,
        canvas.height,
        zoom,
        Math.min(canvas.width, canvas.height) / 2,
      )
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
      bind(lines, lineBuf, LINE_LAYOUT)
      gl.drawArrays(gl.TRIANGLES, 0, lineCount)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.useProgram(sprites)
      uniforms(sprites)
      gl.bindTexture(gl.TEXTURE_2D, atlasTex)
      bind(sprites, spriteBuf, SPRITE_LAYOUT)
      gl.drawArrays(gl.TRIANGLES, 0, spriteCount)
      if (treeLines) {
        // the Great Tree spreads over the land: limbs, then crowns, then the halls on them
        gl.disable(gl.DEPTH_TEST)
        gl.useProgram(lines)
        uniforms(lines)
        bind(lines, treeLines.buf, LINE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, treeLines.count)
        gl.useProgram(sprites)
        uniforms(sprites)
        gl.bindTexture(gl.TEXTURE_2D, treeTex)
        bind(sprites, treeSprites.buf, SPRITE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, treeSprites.count)
      }
      if (hovered && regionLines) {
        gl.disable(gl.DEPTH_TEST)
        gl.useProgram(lines)
        uniforms(lines)
        bind(lines, regionLines.buf, LINE_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, hovered.first, hovered.count)
      }
      if (labelTex && labelCount) {
        gl.disable(gl.DEPTH_TEST)
        gl.useProgram(labelProg)
        uniforms(labelProg)
        gl.uniform1f(gl.getUniformLocation(labelProg, "dpr"), devicePixelRatio)
        gl.bindTexture(gl.TEXTURE_2D, labelTex)
        bind(labelProg, labelBuf, LABEL_LAYOUT)
        gl.drawArrays(gl.TRIANGLES, 0, labelCount)
      }
    }
    const redraw = () => {
      if (!queued) {
        queued = true
        requestAnimationFrame(draw)
      }
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
    data.then(([world, img, labelImg, treeImg]) => {
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
      const STYLE = { rhumb: 1, river: 2, road: 3, route: 4, branch: 5, region: 6 }
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
      ;({ buf: lineBuf, count: lineCount } = buildLines(world.lines))
      ;({ buf: spriteBuf, count: spriteCount } = buildSprites(world.sprites))
      if (world.regions) {
        const list = []
        regions = world.regions.map((r) => {
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
          return { name: r.name, kind: r.kind, rings, area: Math.abs(area) / 2, box, from: start, to: list.length }
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
      if (world.tree) {
        treeLines = buildLines(world.tree.lines)
        treeSprites = buildSprites(world.tree.sprites, world.tree.atlas || world.atlas)
      }

      atlasTex = texture(img)
      treeTex = treeImg ? texture(treeImg) : atlasTex
      if (labelImg && world.labels) {
        const items = world.labels.items
        const cells = world.labels.cells
        const lv2 = new Float32Array((items.length / 4) * 6 * 10)
        let k = 0
        for (let i = 0; i < items.length; i += 4) {
          const cell = cells["lbl" + items[i + 3]]
          const nativeW = (cell[2] - cell[0]) * labelImg.width
          for (const [cx, cy] of QUAD) {
            lv2.set([items[i], items[i + 1], cx, cy, cell[0], cell[1], cell[2], cell[3], items[i + 2], nativeW], k)
            k += 10
          }
        }
        labelCount = k / 10
        labelBuf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, labelBuf)
        gl.bufferData(gl.ARRAY_BUFFER, lv2, gl.STATIC_DRAW)
        labelTex = texture(labelImg)
      }
      ready = true
      redraw()
    })
    new ResizeObserver(redraw).observe(canvas)
    redraw()

    // ---- interaction
    const toDisk = (x, y) => {
      const r = canvas.getBoundingClientRect()
      const s = Math.min(r.width, r.height) / 2
      return clampDisk([(x - r.left - r.width / 2) / s / zoom, (y - r.top - r.height / 2) / s / zoom])
    }
    // the view centre may not go farther than REACH from the Tree; at the limit it slides along
    const R_REACH = Math.tanh(REACH / 2)
    const move = (mv) => {
      let next = compose(mv, view)
      const c = apply(inverse(next), [0, 0])
      const l = Math.hypot(c[0], c[1])
      if (l > R_REACH) next = compose(next, carry([(c[0] / l) * R_REACH, (c[1] / l) * R_REACH], c))
      const moved =
        Math.hypot(next.b[0] - view.b[0], next.b[1] - view.b[1]) +
        Math.hypot(next.a[0] - view.a[0], next.a[1] - view.a[1])
      view = next
      redraw()
      return moved > 1e-7
    }
    // zoom about a screen point, keeping the map point under it in place
    const zoomAt = (x, y, factor) => {
      const z0 = toDisk(x, y)
      const nz = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom * factor))
      if (nz === zoom) return
      zoom = nz
      move(carry(z0, toDisk(x, y)))
      redraw()
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
      const w = apply(inverse(view), toDisk(cx, cy))
      return regions
        .filter((r) => w[0] >= r.box[0] && w[0] <= r.box[2] && w[1] >= r.box[1] && w[1] <= r.box[3])
        .filter((r) => r.rings.some((ring) => inside(ring, w[0], w[1])))
        .sort((a, b) => a.area - b.area)
    }
    const hover = (e) => {
      if (pointers.size || e.pointerType === "touch") return
      const r = canvas.getBoundingClientRect()
      const found = regionsAt(e.clientX, e.clientY)
      const top = found[0] || null
      if (top !== hovered) {
        hovered = top
        redraw()
      }
      if (!top) {
        tip.style.opacity = 0
        return
      }
      tip.innerHTML =
        `<b>${top.name}</b><span>${top.kind}</span>` +
        found
          .slice(1, 3)
          .map((x) => `<i>${x.name}</i>`)
          .join("")
      tip.style.left = `${e.clientX - r.left + 14}px`
      tip.style.top = `${e.clientY - r.top + 14}px`
      tip.style.opacity = 1
    }
    canvas.addEventListener("pointermove", hover)
    canvas.addEventListener("pointerleave", () => {
      hovered = null
      tip.style.opacity = 0
      redraw()
    })

    const pointers = new Map()
    let pinch = null
    let vel = [0, 0]
    let last = 0
    let glide = 0
    const stop = () => cancelAnimationFrame(glide)
    canvas.addEventListener("pointerdown", (e) => {
      stop()
      pointers.set(e.pointerId, [e.clientX, e.clientY])
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
        const p = toDisk(...prev)
        const q = toDisk(...cur)
        const now = performance.now()
        const dt = Math.max(1, now - last)
        vel = [((q[0] - p[0]) / dt) * 16, ((q[1] - p[1]) / dt) * 16]
        last = now
        move(carry(p, q))
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
      if (pointers.size) return
      canvas.classList.remove("dd-grabbing")
      if (performance.now() - last > 80) return
      // coast and slow down; the speed is capped so a flick cannot throw the map far
      let v = vel
      const l = Math.hypot(v[0], v[1])
      const cap = 0.02 / zoom
      if (l > cap) v = [(v[0] / l) * cap, (v[1] / l) * cap]
      const step = () => {
        v = [v[0] * 0.9, v[1] * 0.9]
        if (Math.hypot(v[0], v[1]) < 0.0002 / zoom || !move(carry([0, 0], v))) return
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
