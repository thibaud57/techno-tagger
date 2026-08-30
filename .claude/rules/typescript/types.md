---
paths:
  - "src/app/**/*.ts"
  - "tsconfig.json"
  - "tsconfig.*.json"
---

# TypeScript — Typage & contrat NDJSON

## À faire
- Modéliser tout le contrat NDJSON en unions discriminées, le discriminant étant un type littéral et non `string` : sans littéral, aucun narrowing
- Fermer chaque `switch` sur un événement par une branche `default` posant `const exhaustive: never` : l'ajout d'un événement côté sidecar devient une erreur de compilation côté webview
- Typer le retour de `JSON.parse` en `unknown`, puis le faire passer par un type guard : une assertion de type n'est pas une validation
- Rendre visible une ligne NDJSON invalide plutôt que l'absorber : c'est le symptôme d'un contrat désynchronisé entre les deux côtés
- Garder les modèles miroir dans `core/`, à côté du service sidecar, sans logique
- Utiliser `satisfies` pour valider la forme d'un littéral sans élargir ses types (tables de seuils, de configuration)
- Déclarer explicitement les `types` nécessaires dans `tsconfig.json` : le scan automatique n'a plus lieu
- Garder un job `tsc --noEmit` en CI, distinct du build et des tests
- Exporter toute fonction en `export const nom: TypeDuContrat = (args) => ...`, jamais en `export function` : l'annoter par le type que le framework attend (`CanDeactivateFn`, `ResolveFn`, `BrowserOptions['beforeSend']`) fait échouer la compilation le jour où sa signature change, là où une signature réécrite à la main dérive en silence
- Exporter toute fonction en `export const nom: TypeDuContrat = (args) => ...`, jamais en `export function` : annoter par le type que le framework attend (`CanDeactivateFn`, `ResolveFn`, `BrowserOptions['beforeSend']`) fait echouer la compilation le jour ou sa signature change, la ou une signature reecrite a la main derive en silence

## À éviter
- Monter en TypeScript 7 : le compilateur Angular et `typescript-eslint` échouent tous les deux, ce n'est pas un avertissement mais un échec de build
- Contourner la borne haute par un override de résolution de paquets : les deux outils échouent alors de façon différée et confuse
- Asserter le retour de `JSON.parse` en type métier
- Compter sur les tests pour attraper une erreur de types : Vitest transpile par esbuild et n'exécute pas `tsc`
- Copier un `tsconfig.json` issu d'un projet en TypeScript 5 : plusieurs de ses options n'existent plus
- `export function` pour un callback de framework : sa signature est alors écrite deux fois, une par le SDK et une par nous, et rien ne vérifie qu'elles concordent

## Gotchas
- La borne haute est dure : `@angular/compiler-cli` et `typescript-eslint` consomment l'API de compilation programmatique, absente du cœur natif Go de TypeScript 7. La levée est attendue avec la stabilisation en 7.1, sans date acquise
- Défauts de la 6 : `strict: true`, `module: "esnext"`, `target: "es2025"`, `types: []` et `noUncheckedSideEffectImports: true`. Un type global qui « disparaît » après montée de version vient de `types: []`
- `alwaysStrict: false`, `esModuleInterop: false` et `allowSyntheticDefaultImports: false` ne sont plus acceptés ; `--target es5`, `--module amd/umd/systemjs`, `--moduleResolution classic/node10`, `--outFile` et `--downlevelIteration` sont supprimés ou dépréciés
- Le mot-clé d'import assertions `assert` est remplacé par `with`, et les namespaces en syntaxe `module Foo {}` ne sont plus supportés
- La version est épinglée au tilde pour rester sous la borne, et Renovate ne propose que les patchs (cf. [VERSIONS.md](../../../docs/VERSIONS.md))

## Exemples
```typescript
// ✅ union discriminée + exhaustivité vérifiée à la compilation
export type SidecarEvent =
  | { type: 'progress'; current: number; total: number }
  | { type: 'error'; code: string };

switch (event.type) {
  case 'progress': return this.progress.set(event.current / event.total);
  case 'error': return this.reportError(event.code);
  default: {
    const exhaustive: never = event;
    throw new Error(`Événement non géré : ${JSON.stringify(exhaustive)}`);
  }
}

// ✅ unknown puis guard à la frontière
const parsed: unknown = JSON.parse(line);
if (!isSidecarEvent(parsed)) throw new Error(`Ligne NDJSON invalide : ${line}`);

// ❌ assertion prise pour une validation
const event = JSON.parse(line) as SidecarEvent;
```
