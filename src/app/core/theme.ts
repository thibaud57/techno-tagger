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
    dialog: {
      // La croix se cale sur la premiere ligne du titre (1.75rem, `text-lg`) et sur le bord
      // du contenu, meme sous un en-tete de deux lignes. Le bouton centre une icone de 14px :
      // les marges negatives deplacent l'icone sur ces reperes, pas la zone de clic.
      // Fermee, la balise hote reste un enfant vide de la colonne de la page : un gap de trop.
      css: () => `
        p-dialog,
        p-confirmdialog {
          display: contents;
        }
        .p-dialog-header {
          align-items: flex-start;
        }
        .p-dialog-header-actions {
          margin-block-start: calc((1.75rem - var(--p-button-icon-only-width)) / 2);
          margin-inline-end: calc((0.875rem - var(--p-button-icon-only-width)) / 2);
        }
      `,
    },
  },
})
