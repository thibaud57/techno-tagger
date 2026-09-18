import type { TooltipOptions } from "primeng/api"

/** DESIGN.md § Composants Animés : un survol de passage n'allume rien. */
export const TOOLTIP_DELAY = 400

/** Les 12.5rem par defaut coupent ce qu'un texte tronque ou le detail d'une ligne doit montrer. */
export const WIDE_TOOLTIP: TooltipOptions = {
  showDelay: TOOLTIP_DELAY,
  tooltipStyleClass: "tt-tooltip-wide",
}
