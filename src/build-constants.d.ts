/**
 * Constantes substituees au build par `--define`, declarees dans les scripts de
 * `package.json` et alimentees par le dotenv de `just` en local, par les secrets
 * Actions en CI.
 *
 * Angular ne lit aucun fichier de variables : le CLI compile avec esbuild, pas
 * Vite, donc ni `import.meta.env` ni `process.env` n'existent ici. Et chacune est
 * toujours passee, meme vide : sans substitution l'identifiant reste tel quel et
 * leve un ReferenceError a l'execution.
 */

/** Vide en local : une notice de licence s'affiche, rien ne casse. */
declare const PRIMENG_LICENSE_KEY: string;

/** Lue de `package.json`, donc bumpee par release-please. Doit matcher le sidecar. */
declare const APP_VERSION: string;

/** Vide en local : le SDK reste inerte, rien ne remonte. */
declare const SENTRY_DSN_UI: string;

/** Deduit du script lance : servir, c'est developper. Separe les runs de dev du quota. */
declare const APP_ENVIRONMENT: string;
