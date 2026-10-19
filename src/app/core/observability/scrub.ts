import type { BrowserOptions } from "@sentry/angular"

/**
 * Pendant webview de `_scrub` du sidecar, memes motifs dans le meme ordre : query string
 * d'URL, chemin de lecteur ou UNC, dossier personnel restant. Seule la borne avant un champ
 * logfmt reste propre au sidecar. Le navigateur ne connait pas le nom d'utilisateur de l'OS :
 * le masquage se fait par motif seulement.
 *
 * Les chemins arrivent ici parce que le sidecar en envoie dans ses evenements NDJSON et
 * que l'interface les affiche : un message d'erreur formate autour d'un morceau porte son
 * chemin, donc le nom du fichier, l'artiste et le titre. Les messages JS restent envoyes :
 * ils sont le seul diagnostic de la webview.
 */

export const MASK = "<user>"
export const PATH_MASK = "<path>"
export const QUERY_MASK = "<query>"

// La query string d'une recherche porte l'artiste et le titre. `?` exclu du groupe de
// l'URL, sinon gourmand : il avalerait les `?` intermediaires et laisserait passer tout ce
// qui precede le dernier.
const URL_QUERY = /([a-z][\w+.-]*:\/\/[^\s'"<>?]*)\?[^\s'"<>]*/gi

// Lettre de lecteur (`D:\`, `D:/`) ou partage UNC (`\\serveur\`).
const PATH_START = String.raw`(?:[A-Za-z]:[\\/]|\\\\[^\s\\/'"<>]+[\\/])`

// Trois branches, selon le caractere qui precede le chemin :
// - `"` : jusqu'au `"` suivant ;
// - `'` : jusqu'a la derniere apostrophe de la ligne (glouton, lookahead), pour qu'une
//   apostrophe du nom (« Guns N' Roses ») ne le ferme pas, sans apostrophe fermante jusqu'a la
//   fin de ligne. Le texte entre deux apostrophes apres le chemin est avale avec lui,
//   sur-masquage accepte ;
// - chemin nu : garde espaces et apostrophes, s'arrete a `"`, `<>`, a la fin de ligne et avant
//   `: ` (Windows interdit `:` dans un nom). Une phrase qui suit sans separateur est avalee,
//   sens de panne accepte. Il ne suit ni un caractere de mot, sinon `http://` serait pris pour
//   `p:/`, ni un guillemet.
// Residu accepte : un chemin ouvert par `'` sans guillemet fermant, au nom qui contient une
// apostrophe, laisse la fin du nom apres la derniere apostrophe. Le `repr()` du sidecar entoure
// un tel nom de `"`, forme que la premiere branche couvre.
const WINDOWS_PATH = new RegExp(
  String.raw`(?<=")${PATH_START}[^"\r\n]*` +
    String.raw`|(?<=')${PATH_START}(?:[^\r\n]*(?=')|[^'\r\n]*)` +
    String.raw`|(?<![\w'"])${PATH_START}(?:(?!:\s)[^"<>\r\n])*`,
  "g",
)

// Dossier personnel restant (`/Users/nom`, `/home/nom`, `\Users\nom` sans lettre). Le groupe
// capture le separateur pour rendre la forme d'origine, seul le nom est remplace. Les bornes
// sont les caracteres qu'un nom de dossier Windows ne peut pas porter : tout le reste est
// legal dans un nom de compte, l'espace comme l'apostrophe. Windows nomme le dossier de profil
// d'apres le nom complet d'un compte Microsoft : `Jane Doe` et `O'Brien` ne laisseraient fuir
// que leur seconde moitie.
const HOME = /((?:[A-Za-z]:)?[\\/](?:Users|home)[\\/])[^\\/:*?"<>|\n\r]+/gi

const mask = (text: string): string =>
  text
    .replace(URL_QUERY, `$1?${QUERY_MASK}`)
    .replace(WINDOWS_PATH, PATH_MASK)
    .replace(HOME, `$1${MASK}`)

const maskDeep = (value: unknown): unknown => {
  if (typeof value === "string") return mask(value)
  if (Array.isArray(value)) return value.map(maskDeep)
  if (value && typeof value === "object") {
    // `prepareEvent` normalise avant `beforeSend` : une Error y est deja
    // `{message, name, stack}`, une Date une chaine ISO. Ne pas poser
    // `normalizeDepth: 0`, qui desactiverait cette passe.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [mask(k), maskDeep(v)]))
  }
  return value
}

/** Parcours recursif sans liste de champs : un champ ajoute plus tard est couvert,
 * cles comprises. Pas de cles d'enveloppe exclues comme cote sidecar : les motifs sont
 * ancres, ils ne peuvent matcher ni `release` ni `environment`.
 */
export const scrub: NonNullable<BrowserOptions["beforeSend"]> = (event) =>
  maskDeep(event) as typeof event
