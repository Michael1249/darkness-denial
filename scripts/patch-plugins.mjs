// Patch Quartz community plugins after `npm ci`, for things their options cannot change.
// Each plugin ships its code twice (plugin entry and component bundle), so both files are patched.
// Fails loudly if a plugin changes and a pattern is no longer found.
import fs from "node:fs"

const groups = [
  {
    // Graph: bigger nodes, labels visible without zooming, title «Звёзды».
    files: [
      "node_modules/@quartz-community/graph/dist/index.js",
      "node_modules/@quartz-community/graph/dist/components/index.js",
    ],
    patches: [
      // Node radius: 2 + sqrt(links) px -> 5 + 2 * sqrt(links) px (used for drawing and collisions).
      ["return 2+Math.sqrt(D)", "return 5+2*Math.sqrt(D)", 2],
      // Labels start visible instead of appearing only after the first zoom.
      ["lu.alpha=0", "lu.alpha=1", 1],
      // The plugin's own Russian title «Вид графа» (stored escaped) becomes «Звёзды».
      ["\\u0412\\u0438\\u0434 \\u0433\\u0440\\u0430\\u0444\\u0430", "\\u0417\\u0432\\u0451\\u0437\\u0434\\u044B", 1],
    ],
  },
  {
    // Explorer: the guide is called «Гриливей», an anagram of Вергилий.
    files: [
      "node_modules/@quartz-community/explorer/dist/index.js",
      "node_modules/@quartz-community/explorer/dist/components/index.js",
    ],
    patches: [
      ["\\u041F\\u0440\\u043E\\u0432\\u043E\\u0434\\u043D\\u0438\\u043A", "\\u0413\\u0440\\u0438\\u043B\\u0438\\u0432\\u0435\\u0439", 1],
    ],
  },
]

for (const { files, patches } of groups) {
  for (const file of files) {
    let src = fs.readFileSync(file, "utf8")
    for (const [from, to, count] of patches) {
      if (src.includes(to) && !src.includes(from)) continue // already patched
      const found = src.split(from).length - 1
      if (found !== count) {
        console.error(`patch-plugins: ${file}: expected ${count} of "${from}", found ${found}`)
        process.exit(1)
      }
      src = src.replaceAll(from, to)
    }
    fs.writeFileSync(file, src)
  }
}
console.log("patch-plugins: applied")
