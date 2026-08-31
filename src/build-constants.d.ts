/**
 * Constantes substituees au build par `--define`, declarees dans les scripts de
 * `package.json` et alimentees par le dotenv de `just` en local, par les secrets
 * Actions en CI.
 *
 * Angular ne lit aucun fichier de variables : le CLI compile avec esbuild, pas
 * Vite, donc ni `import.meta.env` ni `process.env` n'existent ici. Et chacune est
 * toujours passee, meme vide : sans substitution l'identifiant reste tel quel et
 * leve un ReferenceError a l'execution.
 *
 * D'ou le meme `define` dans `angular.json`, aux valeurs inertes : il rattrape un
 * `ng build` ou `ng test` lance a la main, et les `--define` des scripts le
 * surchargent cle a cle. Ce JSON n'interpole aucune variable : une constante n'y
 * descend que si sa valeur n'est pas un secret, sinon elle passe par les scripts.
 */

/**
 * Prefixe de la release Sentry, fixe et identique au sidecar : le paquet Python
 * s'appelle `tagger`, deriver donnerait deux chaines incomparables.
 */
declare const APP_NAME: string;

/** Vide en local : une notice de licence s'affiche, rien ne casse. */
declare const PRIMENG_LICENSE_KEY: string;

/** Lue de `package.json`, donc bumpee par release-please. Doit matcher le sidecar. */
declare const APP_VERSION: string;

/** Vide en local : le SDK reste inerte, rien ne remonte. */
declare const SENTRY_DSN_UI: string;

/** Deduit du script lance : servir, c'est developper. Separe les runs de dev du quota. */
declare const APP_ENVIRONMENT: string;
