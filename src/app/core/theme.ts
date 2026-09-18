import { definePreset } from "@primeuix/themes"
import Aura from "@primeuix/themes/aura"

/**
 * Le theme du projet : Aura, plus les seuls ecarts listes ici. Un ecart qui vaut partout
 * s'y range, un ecart d'une seule instance reste un `[dt]` dans son template.
 * Justifications dans DESIGN.md § Installation.
 */
export const TECHNO_TAGGER_PRESET = definePreset(Aura, {
  components: {
    card: {
      root: { borderRadius: "{border.radius.lg}", shadow: "none" },
    },
    tag: {
      root: { borderRadius: "{border.radius.sm}" },
    },
    badge: {
      root: { borderRadius: "{border.radius.xs}" },
    },
    label: {
      root: { fontSize: "0.875rem", fontWeight: "400" },
    },
  },
})
