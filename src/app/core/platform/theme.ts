import { definePreset } from "@primeuix/themes"
import Aura from "@primeuix/themes/aura"

/** Controle compact carre (28px) : boutons a icone seule, croix des modales et du toast. */
const COMPACT_CONTROL = "1.75rem"

/**
 * Le theme du projet : Aura, plus les seuls ecarts listes ici. Un ecart qui vaut partout
 * s'y range, un ecart d'une seule instance reste un `[dt]` dans son template.
 * Justifications dans DESIGN.md § Composition de Styles.
 */
export const TECHNO_TAGGER_PRESET = definePreset(Aura, {
  components: {
    button: {
      // Seule la croix des modales n'est pas `small` : son icone seule prend le carre compact.
      root: { iconOnlyWidth: COMPACT_CONTROL },
      // PrimeNG 22 ne fixe la hauteur d'une icone seule que si le bouton est `rounded` : le carre.
      // Un bouton `link` est toujours un lien de texte, en `text-xs`, ni bordure ni padding, a
      // l'interligne du texte qui l'entoure : il ne grandit pas sa ligne.
      css: () => `
        .p-button-icon-only {
          aspect-ratio: 1;
        }
        .p-button-link {
          padding: 0;
          border: 0;
          font-size: var(--p-button-sm-font-size);
          line-height: inherit;
        }
      `,
    },
    tabs: {
      // Aura 3.0.1 pose un `gap` sur l'onglet sans le passer en flex : icone et libelle centres.
      css: () => `
        .p-tab {
          display: flex;
          align-items: center;
        }
      `,
    },
    card: {
      root: { borderRadius: "{border.radius.lg}", shadow: "none" },
    },
    tag: {
      root: { borderRadius: "{border.radius.sm}" },
    },
    badge: {
      // 12px, le plancher de l'echelle typographique : Aura 3.0.1 le pose a 10px.
      root: { borderRadius: "{border.radius.sm}", fontSize: "0.75rem" },
    },
    toast: {
      // Bouton a icone seule comme les autres : carre de 28px, rayon md (Aura 3.0.1 : rond de 24px).
      closeButton: {
        width: COMPACT_CONTROL,
        height: COMPACT_CONTROL,
        borderRadius: "{border.radius.md}",
      },
    },
    message: {
      // La famille `info` en une teinte : le bleu ciel de `p-tag` et `p-badge`, pas le bleu d'Aura 3.0.1.
      // Valeurs du dark seul, le mode clair n'existe pas.
      info: {
        background: "color-mix(in srgb, {sky.500}, transparent 84%)",
        borderColor: "color-mix(in srgb, {sky.700}, transparent 64%)",
        color: "{sky.500}",
        shadow: "0px 4px 8px 0px color-mix(in srgb, {sky.500}, transparent 96%)",
      },
    },
    label: {
      root: { fontSize: "0.875rem", fontWeight: "400" },
    },
    dialog: {
      // 8px entre les boutons du pied, comme les pieds composes par l'application (Aura 3.0.1 : 6px).
      footer: { gap: "0.5rem" },
      // Croix en carre compact (Aura 3.0.1 : rond de 36px), haute comme la ligne d'un titre `text-lg` :
      // calee sans marge. La marge negative met son icone de 14px sur le bord du contenu.
      // Fermee, la balise host reste un enfant vide de la colonne de la page : un gap de trop.
      css: () => `
        p-dialog,
        p-confirmdialog {
          display: contents;
        }
        .p-dialog-header {
          align-items: flex-start;
        }
        .p-dialog-header-actions {
          margin-inline-end: calc((0.875rem - var(--p-button-icon-only-width)) / 2);
        }
        .p-dialog-header-actions .p-dialog-close-button.p-button-rounded {
          border-radius: var(--p-border-radius-md);
        }
      `,
    },
  },
})
