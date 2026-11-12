// Hyperbolic map of Morra in the Poincaré disk.
// Any element with class "dd-hypermap" gets a WebGL canvas. Dragging moves the map along the
// hyperbolic plane with Möbius transforms: whatever you drag to the middle grows, the Tree shrinks
// towards the rim, and the rim itself is infinitely far. The map turns as you move; that is the
// geometry, not a bug. Double click goes home to the Tree.
// The texture is built by tools/art/hyper_texture.py. Quartz swaps pages without reloading,
// so maps are set up on every "nav" event.
;(() => {
  if (window.__ddHypermap) return
  window.__ddHypermap = true
  const texUrl = new URL("morra-disk.webp", document.currentScript.src).href

  // complex numbers as [re, im]
  const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]
  const conj = (p) => [p[0], -p[1]]
  const add = (p, q) => [p[0] + q[0], p[1] + q[1]]

  // a disk automorphism z -> (a z + b) / (conj(b) z + conj(a)), kept with |a|^2 - |b|^2 = 1
  const norm = ({ a, b }) => {
    const k = Math.sqrt(Math.max(1e-12, a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2))
    return { a: [a[0] / k, a[1] / k], b: [b[0] / k, b[1] / k] }
  }
  const compose = (m, n) =>
    norm({ a: add(mul(m.a, n.a), mul(m.b, conj(n.b))), b: add(mul(m.a, n.b), mul(m.b, conj(n.a))) })
  const shift = (c) => norm({ a: [1, 0], b: c }) // takes 0 to c
  const apply = (m, z) => {
    const num = add(mul(m.a, z), m.b)
    const den = add(mul(conj(m.b), z), conj(m.a))
    const d = den[0] ** 2 + den[1] ** 2
    return [(num[0] * den[0] + num[1] * den[1]) / d, (num[1] * den[0] - num[0] * den[1]) / d]
  }
  // the move that carries point p to point q
  const carry = (p, q) => compose(shift(q), shift([-p[0], -p[1]]))
  const clamp = (z, r = 0.97) => {
    const l = Math.hypot(z[0], z[1])
    return l > r ? [(z[0] / l) * r, (z[1] / l) * r] : z
  }

  const VERT = "attribute vec2 v; void main(){ gl_Position = vec4(v, 0., 1.); }"
  const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec4 m;      // a = m.xy, b = m.zw of the current view
uniform float size;  // canvas size in device pixels
vec2 cmul(vec2 p, vec2 q){ return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }
vec2 cdiv(vec2 p, vec2 q){ return vec2(p.x*q.x + p.y*q.y, p.y*q.x - p.x*q.y) / dot(q, q); }
void main(){
  vec2 z = vec2(gl_FragCoord.x / size * 2. - 1., 1. - gl_FragCoord.y / size * 2.);
  float r = length(z);
  float edge = 1. - smoothstep(1. - 2.5 / size, 1., r);
  if (edge <= 0.) discard;
  vec2 a = m.xy, b = m.zw;
  // inverse view: w = (conj(a) z - b) / (a - conj(b) z)
  vec2 w = cdiv(cmul(vec2(a.x, -a.y), z) - b, a - cmul(vec2(b.x, -b.y), z));
  vec3 c = texture2D(tex, w * .5 + .5).rgb;
  // a little haze towards the infinitely far rim
  c = mix(c, vec3(.93, .95, .96), smoothstep(.86, 1., r) * .55);
  gl_FragColor = vec4(c * edge, edge);
}`

  let image = null
  const imageReady = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve((image = img))
    img.src = texUrl
  })

  function setup(host) {
    if (host.__ddMap) return
    host.__ddMap = true
    const canvas = document.createElement("canvas")
    host.appendChild(canvas)
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false })
    if (!gl) {
      host.classList.add("dd-hypermap-flat")
      imageReady.then((img) => host.replaceChild(img.cloneNode(), canvas))
      return
    }
    const sh = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, "v")
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uM = gl.getUniformLocation(prog, "m")
    const uSize = gl.getUniformLocation(prog, "size")
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    let view = { a: [1, 0], b: [0, 0] }
    let ready = false
    let queued = false
    const draw = () => {
      queued = false
      if (!ready || !canvas.isConnected) return
      const px = Math.round(canvas.clientWidth * devicePixelRatio)
      if (canvas.width !== px) canvas.width = canvas.height = px
      gl.viewport(0, 0, px, px)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform4f(uM, view.a[0], view.a[1], view.b[0], view.b[1])
      gl.uniform1f(uSize, px)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    const redraw = () => {
      if (!queued) {
        queued = true
        requestAnimationFrame(draw)
      }
    }
    imageReady.then((img) => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const aniso = gl.getExtension("EXT_texture_filter_anisotropic")
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8)
      ready = true
      redraw()
    })
    new ResizeObserver(redraw).observe(canvas)

    // pointer -> disk coordinates
    const toDisk = (e) => {
      const r = canvas.getBoundingClientRect()
      return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1]
    }
    const move = (p, q) => {
      view = compose(carry(clamp(p), clamp(q)), view)
      redraw()
    }

    let grab = null
    let vel = [0, 0]
    let last = 0
    let glide = 0
    canvas.addEventListener("pointerdown", (e) => {
      const p = toDisk(e)
      if (Math.hypot(p[0], p[1]) > 1) return
      cancelAnimationFrame(glide)
      grab = p
      vel = [0, 0]
      last = performance.now()
      canvas.setPointerCapture(e.pointerId)
      canvas.classList.add("dd-grabbing")
    })
    canvas.addEventListener("pointermove", (e) => {
      if (!grab) return
      const q = toDisk(e)
      const now = performance.now()
      const dt = Math.max(1, now - last)
      vel = [((q[0] - grab[0]) / dt) * 16, ((q[1] - grab[1]) / dt) * 16]
      last = now
      move(grab, q)
      grab = q
    })
    const release = () => {
      if (!grab) return
      const at = grab
      grab = null
      canvas.classList.remove("dd-grabbing")
      if (performance.now() - last > 80) return
      // let the map coast and slow down; the speed is measured where the pointer was, turned into
      // the same hyperbolic speed at the centre, and capped so a flick cannot throw it to the rim
      const k = 1 / Math.max(0.05, 1 - (at[0] ** 2 + at[1] ** 2))
      let v = [vel[0] * k * 0.5, vel[1] * k * 0.5]
      const l = Math.hypot(v[0], v[1])
      if (l > 0.025) v = [(v[0] / l) * 0.025, (v[1] / l) * 0.025]
      const step = () => {
        v = [v[0] * 0.92, v[1] * 0.92]
        if (Math.hypot(v[0], v[1]) < 0.0003) return
        move([0, 0], v)
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    }
    canvas.addEventListener("pointerup", release)
    canvas.addEventListener("pointercancel", release)

    // double click: go home to the Tree
    canvas.addEventListener("dblclick", () => {
      cancelAnimationFrame(glide)
      const step = () => {
        const tree = apply(view, [0, 0])
        if (Math.hypot(tree[0], tree[1]) < 0.002) {
          view = compose(carry(tree, [0, 0]), view)
          redraw()
          return
        }
        move(tree, [tree[0] * 0.82, tree[1] * 0.82])
        glide = requestAnimationFrame(step)
      }
      glide = requestAnimationFrame(step)
    })
  }

  const scan = () => document.querySelectorAll(".dd-hypermap").forEach(setup)
  document.addEventListener("nav", scan)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan)
  else scan()
})()
