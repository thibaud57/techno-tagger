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
- Écrire toute fonction en `const nom = (args) => ...`, exportée ou locale, helpers de test compris : la règle ESLint `func-style` fait échouer le lint sur une déclaration `function`
- Exporter une fonction de framework en `export const nom: TypeDuContrat = (args) => ...` (`CanDeactivateFn`, `ResolveFn`…) : la compilation casse quand la signature du framework change

## À éviter
- Monter en TypeScript 7, même par un override de résolution : le compilateur Angular et `typescript-eslint` échouent
- Asserter le retour de `JSON.parse` en type métier
- Compter sur les tests pour attraper une erreur de types : Vitest transpile par esbuild et n'exécute pas `tsc`
- Copier un `tsconfig.json` issu d'un projet en TypeScript 5 : plusieurs de ses options n'existent plus

## Gotchas
- TypeScript 7 n'expose plus l'API de compilation programmatique dont dépendent `@angular/compiler-cli` et `typescript-eslint`
- Défauts de la 6 : `strict`, `module: "esnext"`, `target: "es2025"`, `types: []`. Un type global qui « disparaît » vient de `types: []`
- La 6 refuse `alwaysStrict: false`, `esModuleInterop: false`, `--target es5`, `--moduleResolution node10` et `--outFile`
- Le mot-clé d'import assertions `assert` est remplacé par `with`, et les namespaces en syntaxe `module Foo {}` ne sont plus supportés
- La version est épinglée au tilde pour rester sous la borne, et Dependabot proposera la majeure en PR séparée, à refuser tant que la borne tient (cf. [VERSIONS.md](../../../docs/VERSIONS.md))

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
