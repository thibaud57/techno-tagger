import type { TooltipOptions } from "primeng/api"

/** DESIGN.md § Composants Animés : un survol de passage n'allume rien. */
const TOOLTIP_DELAY = 400

/**
 * Sous l'element, comme tous les tooltips : a droite, la place manque des que la colonne ou le
 * bouton touche le bord de la fenetre.
 */
const TOOLTIP_POSITION = "bottom"

/**
 * Jeu de tout tooltip, lie par `[tooltipOptions]` : PrimeNG n'a aucun defaut global et
 * retombe sinon sur la droite, sans delai.
 */
export const TOOLTIP: TooltipOptions = {
  showDelay: TOOLTIP_DELAY,
  tooltipPosition: TOOLTIP_POSITION,
}

/** Les 12.5rem par defaut coupent ce qu'un texte tronque ou le detail d'une ligne doit montrer. */
export const WIDE_TOOLTIP: TooltipOptions = {
  ...TOOLTIP,
  tooltipStyleClass: "tt-tooltip-wide",
}
