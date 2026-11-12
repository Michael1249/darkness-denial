// Hyperbolic map of Morra in the Poincaré disk.
// Any element with class "dd-hypermap" becomes a map window. Dragging moves the map along the
// hyperbolic plane with Möbius transforms, so the map turns as you go: that is the geometry.
// Zoom (wheel, pinch, buttons) magnifies the window onto the disk and is kept within limits.
// You cannot wander off into the ice beyond the coast: the edge of the world is out of reach.
// The texture is the flat map from tools/art/hyper_texture.py; the shader turns each screen
// point into a Poincaré point and then into a flat-map point. Quartz swaps pages without
// reloading, so windows are set up on every "nav" event.
;(() => {
  if (window.__ddHypermap) return
  window.__ddHypermap = true
  const texUrl = new URL("morra-flat.webp", document.currentScript.src).href

  // must match tools/art/hyper_texture.py and world_map.py
  const A = 1.93 // flat radius ICE lands at Poincaré radius tanh(A)
  const ICE = 660 // outer ice radius in flat map units
  const HALF = 680 // the texture covers the centre +- HALF map units
  const ZOOM = { start: 3, min: 1.5, max: 6 } // window radius in the disk is 1 / zoom
  const REACH = (2 * A * 470) / ICE // farthest view centre from the Tree: just past the coast

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
  const inverse = (m) => ({ a: conj(m.a), b: [-m.b[0], -m.b[1]] })
  const carry = (p, q) => compose(shift(q), shift([-p[0], -p[1]])) // takes p to q
  const clampDisk = (z, r = 0.995) => {
    const l = Math.hypot(z[0], z[1])
    return l > r ? [(z[0] / l) * r, (z[1] / l) * r] : z
  }
  const dist0 = (z) => 2 * Math.atanh(Math.min(0.999999, Math.hypot(z[0], z[1])))

  const VERT = "attribute vec2 v; void main(){ gl_Position = vec4(v, 0., 1.); }"
  const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec4 m;       // a = m.xy, b = m.zw of the current view
uniform vec3 screen;  // width, height in device pixels, zoom
uniform vec3 paper;   // colour beyond the world
const float A = ${A.toFixed(4)};
const float ICE = ${ICE.toFixed(1)};
const float HALF = ${HALF.toFixed(1)};
vec2 cmul(vec2 p, vec2 q){ return vec2(p.x*q.x - p.y*q.y, p.x*q.y + p.y*q.x); }
vec2 cdiv(vec2 p, vec2 q){ return vec2(p.x*q.x + p.y*q.y, p.y*q.x - p.x*q.y) / dot(q, q); }
void main(){
  float s = min(screen.x, screen.y);
  vec2 q = vec2(gl_FragCoord.x - screen.x * .5, screen.y * .5 - gl_FragCoord.y) / (s * .5);
  vec2 z = q / screen.z;
  float r = length(z);
  if (r >= 1.) { gl_FragColor = vec4(paper, 1.); return; }
  vec2 a = m.xy, b = m.zw;
  vec2 w = cdiv(cmul(vec2(a.x, -a.y), z) - b, a - cmul(vec2(b.x, -b.y), z));
  float rw = min(length(w), .999999);
  float rho = ICE * 0.5 * log((1. + rw) / (1. - rw)) / A;
  vec2 fp = rw > 0. ? w / rw * rho : vec2(0.);
  vec2 uv = fp / (2. * HALF) + .5;
  vec3 c = texture2D(tex, clamp(uv, 0., 1.)).rgb;
  c = mix(c, paper, smoothstep(ICE * .97, ICE * 1.3, rho));
  float rim = smoothstep(1. - 3. / s / screen.z, 1., r);
  gl_FragColor = vec4(mix(c, paper, rim), 1.);
}`

  const imageReady = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.src = texUrl
  })

  function setup(host) {
    if (host.__ddMap) return
    host.__ddMap = true
    const canvas = document.createElement("canvas")
    host.appendChild(canvas)
    const gl = canvas.getContext("webgl", { antialias: false })
    if (!gl) {
      imageReady.then((img) => host.replaceChild(img.cloneNode(), canvas))
      return
    }
    const sh = (type, src) => {
      const s = gl.createShader(type)
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s))
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
    const uScreen = gl.getUniformLocation(prog, "screen")
    const uPaper = gl.getUniformLocation(prog, "paper")

    let view = { a: [1, 0], b: [0, 0] }
    let zoom = ZOOM.start
    let ready = false
    let queued = false
    const paper = () => {
      const c = getComputedStyle(host).backgroundColor.match(/\d+(\.\d+)?/g) || [20, 18, 30]
      return c.slice(0, 3).map((x) => x / 255)
    }
    const draw = () => {
      queued = false
      if (!ready || !canvas.isConnected) return
      const w = Math.round(canvas.clientWidth * devicePixelRatio)
      const h = Math.round(canvas.clientHeight * devicePixelRatio)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      gl.viewport(0, 0, w, h)
      gl.uniform4f(uM, view.a[0], view.a[1], view.b[0], view.b[1])
      gl.uniform3f(uScreen, w, h, zoom)
      gl.uniform3f(uPaper, ...paper())
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

    // screen pointer -> point of the Poincaré disk under it
    const toDisk = (x, y) => {
      const r = canvas.getBoundingClientRect()
      const s = Math.min(r.width, r.height) / 2
      return clampDisk([(x - r.left - r.width / 2) / s / zoom, (y - r.top - r.height / 2) / s / zoom])
    }
    // move the map; the view centre may not go farther than REACH from the Tree,
    // so at the limit the map slides along it instead of going on
    const R_REACH = Math.tanh(REACH / 2)
    const move = (m) => {
      let next = compose(m, view)
      const c = apply(inverse(next), [0, 0])
      const l = Math.hypot(c[0], c[1])
      if (l > R_REACH) next = compose(next, carry([(c[0] / l) * R_REACH, (c[1] / l) * R_REACH], c))
      const moved = Math.hypot(next.b[0] - view.b[0], next.b[1] - view.b[1]) + Math.hypot(next.a[0] - view.a[0], next.a[1] - view.a[1])
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
      if (!move(carry(z0, toDisk(x, y)))) redraw()
    }

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
  }

  const scan = () => document.querySelectorAll(".dd-hypermap").forEach(setup)
  document.addEventListener("nav", scan)
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan)
  else scan()
})()
