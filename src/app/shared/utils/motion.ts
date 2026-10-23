/**
 * Fondu d'entree de DESIGN.md § Animations. Les classes sont celles du plugin : c'est
 * ce qui permet a la coupure `prefers-reduced-motion` de `styles.css` de les attraper.
 */
export const FADE_IN = "animate-fadein animate-duration-200 animate-ease-out"

/** Aucune animation sur une modale du chemin de decision (§ Composants Animes). */
export const NO_MOTION = { disabled: true } as const
