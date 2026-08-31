---
title: "TypeScript 6 — Typage du frontend"
version: "6.0.x"
description: "Référence technique pour TypeScript 6 : contrainte de version dure imposée par Angular 22, nouveaux défauts stricts, unions discriminées et type guards pour le contrat NDJSON."
date: "2026-08-29"
keywords: ["typescript", "angular", "unions-discriminees", "type-guards", "satisfies", "tsgo"]
scope: ["docs"]
technologies: ["Angular", "Vitest", "angular-eslint"]
---

# Description

Langage du frontend, contraint par Angular 22 à la plage **`>=6.0.0 <6.1.0`**. Ce n'est pas une préférence : c'est une borne dure imposée par `@angular/compiler-cli` (cf. [VERSIONS.md](../VERSIONS.md#2-typescript)).

Son rôle principal dans ce projet est de **typer les modèles miroir du contrat NDJSON**. Ces messages franchissent une frontière de sérialisation depuis un process externe : le typage seul ne les valide pas, il documente ce qu'on attend.

TypeScript 6 est la dernière version bâtie sur le code JavaScript historique, marche-pied vers la réécriture Go de la version 7.

---

# Concepts Clés

## Pourquoi la borne supérieure est dure

### Description

`@angular/compiler-cli` et `typescript-eslint` consomment tous deux l'API de compilation programmatique de TypeScript, pour transformer des AST. Cette API n'existe pas encore de façon stable sur le nouveau cœur natif Go (`tsgo`) de TypeScript 7.

### Points Importants

- **Installer TypeScript 7 casse le compilateur Angular**, avec des incompatibilités sur les entrées du `compiler-cli`. Ce n'est pas un avertissement de compatibilité, c'est un échec de build
- **`typescript-eslint` refuse l'installation** avec TypeScript 7 : sa `peerDependency` s'arrête sous `6.1.0`, d'où un `ERESOLVE` au premier `install`
- La demande d'élargissement de la plage côté Angular **a été fermée sans suite** : la levée est attendue avec la stabilisation de l'API en TypeScript 7.1, pas avant. Ce calendrier vient de sources secondaires, à ne pas traiter comme une date acquise
- **Ne pas tenter de forcer par un override de résolution** : les deux outils échoueront de façon différée et confuse

---

## Nouveaux défauts de TypeScript 6

### Description

Un `tsconfig.json` généré par TypeScript 6 n'a plus les mêmes valeurs par défaut qu'en 5.x. Le mode strict n'est plus une option à cocher.

### Exemple

```jsonc
// Défauts de la version 6, sans les écrire
{
  "strict": true,              // était false
  "module": "esnext",          // était commonjs
  "target": "es2025",          // était es5
  "types": [],                 // était : scan automatique de tous les @types
  "noUncheckedSideEffectImports": true
}
```

### Points Importants

- **`alwaysStrict: false` n'est plus autorisé** : le mode strict est obligatoire
- **`types: []` par défaut** : les types globaux ne sont plus ramassés automatiquement, il faut les déclarer. Un type global qui « disparaît » après montée de version vient de là
- `--target es5`, `--module amd/umd/systemjs`, `--moduleResolution classic/node10`, `--outFile` et `--downlevelIteration` ont été supprimés ou dépréciés
- `esModuleInterop: false` et `allowSyntheticDefaultImports: false` ne sont plus acceptés
- Le mot-clé d'import assertions `assert` est remplacé par `with`
- Les namespaces en syntaxe `module Foo {}` ne sont plus supportés

---

## Unions discriminées pour le contrat NDJSON

### Description

Chaque message du sidecar porte un champ littéral qui l'identifie. C'est ce qui permet à TypeScript de restreindre le type dans chaque branche.

### Exemple

```typescript
export type SidecarEvent =
  | { type: 'progress'; current: number; total: number }
  | { type: 'track_resolved'; trackId: string; source: 'beatport' | 'bandcamp' }
  | { type: 'arbitration_required'; trackId: string; candidates: Candidate[] }
  | { type: 'error'; code: string; message: string };

function handle(event: SidecarEvent): void {
  switch (event.type) {
    case 'progress':
      return this.progress.set(event.current / event.total);
    case 'track_resolved':
      return this.markResolved(event.trackId, event.source);
    case 'arbitration_required':
      return this.queue.push(event);
    case 'error':
      return this.reportError(event.code);
    default: {
      const exhaustive: never = event;
      throw new Error(`Événement non géré : ${JSON.stringify(exhaustive)}`);
    }
  }
}
```

### Points Importants

- **La branche `default` avec `const exhaustive: never`** transforme l'ajout d'un événement côté sidecar en erreur de compilation côté webview : c'est le principal intérêt du modèle miroir
- Le discriminant doit être un **type littéral**, pas `string` : sinon aucun narrowing
- Les modèles miroir vivent dans `core/`, à côté du service sidecar, et n'ont pas de logique

---

## Type guards à la frontière

### Description

Une ligne NDJSON vient d'un process externe. `JSON.parse` rend `any` : la déclarer conforme au type ne la valide pas.

### Exemple

```typescript
function isSidecarEvent(value: unknown): value is SidecarEvent {
  return typeof value === 'object' && value !== null
    && 'type' in value && typeof (value as { type: unknown }).type === 'string';
}

export function parseLine(line: string): SidecarEvent {
  const parsed: unknown = JSON.parse(line);
  if (!isSidecarEvent(parsed)) {
    throw new Error(`Ligne NDJSON invalide : ${line}`);
  }
  return parsed;
}
```

### Points Importants

- **Typer le résultat de `JSON.parse` en `unknown`, jamais en `SidecarEvent` directement** : une assertion de type n'est pas une validation
- Le guard vérifie la forme minimale ; la validation de fond reste côté sidecar, qui valide toute commande contre son modèle avant exécution
- **Une ligne invalide doit être visible**, pas absorbée : c'est le symptôme d'un contrat désynchronisé entre les deux côtés

---

## `satisfies`

### Description

Valide la forme d'un littéral tout en conservant ses types littéraux, là où une annotation les élargirait.

### Exemple

```typescript
const thresholds = {
  floor: 70,
  ceiling: 90,
} satisfies Record<string, number>;

// thresholds.floor est de type 70, pas number
```

### Points Importants

- **`satisfies` vérifie sans élargir**, contrairement à `const x: Type = ...`
- Utile pour les tables de configuration dont on veut garder les clés exactes
- Ne remplace pas une validation à l'exécution : c'est du typage statique

---

# Commandes Clés

## Type-checking

### Description

Le type-check est distinct du build Angular : il tourne aussi en CI, séparément.

### Syntaxe

```bash
pnpm exec tsc --noEmit           # type-check seul, usage CI
pnpm exec tsc -p tsconfig.json   # compile selon une config donnée
pnpm exec tsc --watch            # recompile en continu
```

### Points Importants

- **`--noEmit` est la forme à mettre en CI** : elle vérifie sans produire de fichiers
- Le build Angular fait son propre type-check, mais un job `tsc --noEmit` échoue plus vite et plus clairement
- Vitest transpile via esbuild et **n'exécute pas `tsc`** : un test qui passe ne prouve pas que les types sont corrects

---

# Bonnes Pratiques

## ✅ Recommandations

- **Épingler TypeScript dans la plage exigée par Angular** et laisser Renovate proposer les patchs sans franchir la borne
- **Modéliser tout le contrat NDJSON en unions discriminées** avec une branche `never` d'exhaustivité
- **Typer les entrées externes en `unknown`** puis les faire passer par un type guard
- **Garder un job `tsc --noEmit` en CI**, distinct du build et des tests
- **Déclarer explicitement les `types` nécessaires** dans `tsconfig.json`, le scan automatique n'ayant plus lieu

## ❌ Anti-Patterns

- **Monter en TypeScript 7 pour « être à jour »** : le compilateur Angular et typescript-eslint échouent tous les deux
- **Contourner la borne par un override de résolution de paquets** : l'échec devient différé et opaque
- **Asserter le retour de `JSON.parse` en type métier** : c'est du typage, pas de la validation
- **Utiliser `string` comme discriminant** : sans type littéral, aucun narrowing
- **Compter sur les tests pour attraper une erreur de types** : Vitest ne type-check pas
- **Copier un `tsconfig.json` d'un projet en TypeScript 5** : plusieurs options qu'il contient n'existent plus

---

# 🔗 Ressources

## Documentation Officielle

- [Annonce TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)
- [Notes de version 6.0](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
- [Référence tsconfig](https://www.typescriptlang.org/tsconfig/)

## Ressources Complémentaires

- [VERSIONS.md](../VERSIONS.md) — contrainte de version et conflits potentiels
- [angular-eslint.md](angular-eslint.md) — typed linting et `projectService`
