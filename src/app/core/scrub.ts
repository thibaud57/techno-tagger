import type { BrowserOptions } from '@sentry/angular';

/**
 * Pendant webview de `_scrub` du sidecar. Le navigateur ne connait pas le nom
 * d'utilisateur de l'OS : le masquage se fait donc par motif de chemin, sur les
 * trois formes que produisent Windows, macOS et Linux.
 *
 * Les chemins arrivent ici parce que le sidecar en envoie dans ses evenements
 * NDJSON et que l'interface les affiche : un message d'erreur formate autour
 * d'un morceau porte le chemin, donc le nom de l'utilisateur.
 */

export const MASK = '<user>';

// `C:\Users\nom`, `C:/Users/nom`, `/Users/nom`, `/home/nom`. Le groupe capture le
// separateur pour rendre la forme d'origine, seul le nom est remplace.
// L'espace n'est pas une borne : Windows nomme le dossier de profil d'apres le nom
// complet d'un compte Microsoft, et `Jean Dupont` ne laisserait fuir que sa
// seconde moitie.
const HOME = /((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/\n\r"']+/gi;

function mask(text: string): string {
  return text.replace(HOME, `$1${MASK}`);
}

function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    // `prepareEvent` normalise avant `beforeSend` : une Error y est deja
    // `{message, name, stack}`, une Date une chaine ISO. Ne pas poser
    // `normalizeDepth: 0`, qui desactiverait cette passe.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [mask(k), maskDeep(v)]));
  }
  return value;
}

/** Parcours recursif sans liste de champs : un champ ajoute plus tard est couvert,
 * cles comprises. Pas de cles d'enveloppe exclues comme cote sidecar : le motif de
 * chemin est ancre, il ne peut matcher ni `release` ni `environment`.
 */
export const scrub: NonNullable<BrowserOptions['beforeSend']> = (event) =>
  maskDeep(event) as typeof event;
