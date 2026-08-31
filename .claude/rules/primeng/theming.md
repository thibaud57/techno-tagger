---
paths:
  - "src/app/app.config.ts"
  - "package.json"
---

# PrimeNG — Thème & licence

## À faire
- Provisionner la clé PrimeUI avant le premier build et la passer en `license` de `providePrimeNG()` : elle est requise même en Community License (cf. [ADR-003](../../../docs/adrs/003-primeng-community-license.md))
- Déclarer `@primeuix/themes` explicitement dans `package.json` : PrimeNG ne le tire pas, et l'import du preset échoue sans lui
- Personnaliser par `definePreset()` en redéfinissant des tokens, le Theme Designer étant hors Community License
- Référencer une primitive (`{violet.500}`) plutôt que de recopier un hexadécimal, pour garder la palette cohérente
- Surcharger un composant par ses tokens (clé `components` du preset), jamais par un sélecteur CSS
- Écrire le `@custom-variant dark` de Tailwind sur **exactement** le sélecteur passé en `darkModeSelector`, dans le même commit (cf. [setup.md](../tailwindcss/setup.md))

## À éviter
- Copier une configuration PrimeNG issue d'un projet en v21 : la base rem, les icônes et la licence ont toutes changé
- Le preset `aura-compat` par confort : il fige le calibrage 14px que le projet a explicitement écarté
- Écrire du CSS ciblant les classes internes des composants : il casse à la première montée de version, les tokens sont là pour ça
- Ouvrir une issue sur le dépôt GitHub `primefaces/primeng` en attendant une réponse : il est archivé depuis juin 2026 et n'est plus le canal de support

> Le câblage de `providePrimeNG()` (preset importé, valeurs exactes de `darkModeSelector` et de `cssLayer`) est dans [angular/app-config.md](../angular/app-config.md), qui porte le bootstrap.

## Gotchas
- **La propriété est `license`**, confirmée par la page Installation de PrimeNG (`providePrimeNG({ theme: Aura, license: "PRIMEUI-LICENSE-KEY" })`). **Le canal est tranché** : `--define` du builder Angular, alimenté par `PRIMENG_LICENSE_KEY` (dotenv de `just` en local, secret Actions en CI), identifiant déclaré dans `src/build-constants.d.ts`. `environments/` a été écarté : c'est un mécanisme de configuration versionnée, inadapté à un secret qui ne doit jamais être commité
- Sans clé valide, les composants affichent une notice de licence, **y compris en développement** : la webview Tauri n'est pas exemptée, contrairement à ce qu'on lit sur l'exemption localhost. C'est donc un prérequis du premier `just dev`, pas seulement du premier build
- La clé Community est gratuite, valable 12 mois avec 30 jours de grâce, et renouvelable
- La base rem est passée de 14px à 16px en v22 : tout style maison calé sur 14px se retrouve décalé
- Aucune limitation fonctionnelle sur la bibliothèque centrale en Community, et les versions antérieures à la v22 restent MIT pour toujours
- `prefix: 'p'` fixe le préfixe des variables CSS (`--p-primary-color`), consommées aussi côté Tailwind par `tailwindcss-primeui`

## Exemples
```typescript
// ✅ personnalisation par tokens
const TaggerPreset = definePreset(Aura, {
  semantic: { primary: { 500: '{violet.500}' } },
});

providePrimeNG({
  theme: { preset: TaggerPreset, options: { prefix: 'p', darkModeSelector: DARK_SELECTOR } },
  license: PRIMENG_LICENSE_KEY,   // fournie au build depuis les secrets, jamais commitée
});

// ❌ surcharge par sélecteur : casse à la montée de version
.p-button.p-button-primary { background: #7c3aed; }
```
