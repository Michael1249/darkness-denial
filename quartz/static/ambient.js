// Background ambient loop for the wiki.
// Browsers block sound until the visitor interacts with the page, so playback
// starts on the first click, tap or key press. The audio object and the toggle
// live on <html>, outside <body>, so Quartz's page-to-page navigation keeps them.
;(() => {
  if (window.__ddAmbient) return
  const src = new URL("ambient.mp3", document.currentScript.src).href
  const audio = new Audio(src)
  audio.loop = true
  audio.volume = 0.5
  let muted = false
  try {
    muted = localStorage.getItem("dd-ambient-muted") === "1"
  } catch {}

  const button = document.createElement("button")
  button.className = "dd-ambient-toggle"
  const render = () => {
    button.textContent = muted ? "♪̸" : "♪"
    button.title = muted ? "Включить звук" : "Выключить звук"
    button.setAttribute("aria-label", button.title)
  }
  render()
  document.documentElement.appendChild(button)

  const play = () => {
    if (!muted) audio.play().catch(() => {})
  }
  const unlock = () => {
    play()
    for (const ev of ["pointerdown", "keydown", "touchstart"]) removeEventListener(ev, unlock, true)
  }
  for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, unlock, true)

  button.addEventListener("click", (e) => {
    e.stopPropagation()
    muted = !muted
    try {
      localStorage.setItem("dd-ambient-muted", muted ? "1" : "0")
    } catch {}
    if (muted) audio.pause()
    else audio.play().catch(() => {})
    render()
  })

  window.__ddAmbient = audio
  play()
})()
