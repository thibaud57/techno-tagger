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
const HOME = /((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/\s"']+/gi;

function mask(text: string): string {
  return text.replace(HOME, `$1${MASK}`);
}

function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

/** Parcours recursif sans liste de champs : un champ ajoute plus tard est couvert.
 * Type par le contrat du SDK : un changement de signature casse a la compilation.
 */
export const scrub: NonNullable<BrowserOptions['beforeSend']> = (event) =>
  maskDeep(event) as typeof event;
