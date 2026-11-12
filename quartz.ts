import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import * as ExternalPlugin from "./.quartz/plugins"

// Explorer («Гриливей») order. The function runs in the browser as text, so it must be
// self-contained. Pages listed here come first in this order; any other page follows,
// sorted by name. Add new pages to the list to place them.
ExternalPlugin.Explorer({
  sortFn: (a, b) => {
    // No named inner functions here: the bundler wraps them in a helper the browser lacks.
    const order = ["о-космосе", "о-мире", "о-пустоте", "о-времени", "о-вечном", "о-праве", "о-страхе", "о-нас", "о·"]
    const ia = order.indexOf(a.slugSegment) < 0 ? order.length : order.indexOf(a.slugSegment)
    const ib = order.indexOf(b.slugSegment) < 0 ? order.length : order.indexOf(b.slugSegment)
    if (ia !== ib) return ia - ib
    return a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: "base" })
  },

})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
