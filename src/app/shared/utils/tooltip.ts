import type { TooltipOptions } from "primeng/api"

/**
 * Tooltip revelant une valeur coupee a l'ecran (DESIGN.md § Tokens de Tooltip) : 400ms de delai
 * pour qu'un survol de passage n'allume rien, et la largeur `wide`, les 12.5rem par defaut
 * coupant precisement ce qu'il est la pour montrer.
 */
export const TRUNCATED_VALUE_TOOLTIP: TooltipOptions = {
  showDelay: 400,
  tooltipStyleClass: "tt-tooltip-wide",
}
