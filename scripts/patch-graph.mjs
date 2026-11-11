// Patch @quartz-community/graph: bigger nodes, and labels visible without zooming in.
// The plugin hard-codes both, so this edits its built file after `npm ci`.
// Fails loudly if the plugin changes and a pattern is no longer found.
import fs from "node:fs"

// The plugin ships the graph script twice: the plugin entry and the component bundle the site loads.
const files = [
  "node_modules/@quartz-community/graph/dist/index.js",
  "node_modules/@quartz-community/graph/dist/components/index.js",
]

const patches = [
  // Node radius: 2 + sqrt(links) px -> 5 + 2 * sqrt(links) px (used for drawing and collisions).
  ["return 2+Math.sqrt(D)", "return 5+2*Math.sqrt(D)", 2],
  // Labels start visible instead of appearing only after the first zoom.
  ["lu.alpha=0", "lu.alpha=1", 1],
]

for (const file of files) {
  let src = fs.readFileSync(file, "utf8")
  for (const [from, to, count] of patches) {
    if (src.includes(to) && !src.includes(from)) continue // already patched
    const found = src.split(from).length - 1
    if (found !== count) {
      console.error(`patch-graph: ${file}: expected ${count} of "${from}", found ${found}`)
      process.exit(1)
    }
    src = src.replaceAll(from, to)
  }
  fs.writeFileSync(file, src)
}
console.log("patch-graph: applied")
