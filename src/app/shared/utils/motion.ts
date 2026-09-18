/**
 * Fondu d'entree de DESIGN.md § Animations. Les classes sont celles du plugin, et c'est
 * ce qui permet a la coupure `prefers-reduced-motion` de `styles.css` de les attraper.
 */
export const FADE_IN = "animate-fadein animate-duration-200 animate-ease-out"

/** Hote d'une page d'onglet : le shell pose le container, la page empile ses sections dedans. */
export const PAGE_HOST = "flex min-h-0 flex-1 flex-col gap-6"
