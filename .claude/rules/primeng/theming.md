---
paths:
  - "src/app/app.config.ts"
  - "src/app/core/platform/theme.ts"
  - "package.json"
---

# PrimeNG : thème et licence

## À faire
- Provisionner la clé PrimeUI avant le premier build et la passer en `license` de `providePrimeNG()` : elle est requise même en Community License (cf. [ADR-003](../../../docs/adrs/003-primeng-community-license.md))
- Déclarer `@primeuix/themes` explicitement dans `package.json` : PrimeNG ne le tire pas et l'import du preset échoue sans lui
- Personnaliser par `definePreset()` en redéfinissant des tokens, le Theme Designer étant hors Community License
- Référencer une primitive (`{violet.500}`) plutôt que de recopier un hexadécimal, pour garder la palette cohérente
- Surcharger un composant par ses tokens (clé `components` du preset) et ne passer par la clé `css` du preset que pour ce qu'aucun token n'expose (bouton à icône seule, en-tête de modale), jamais par une feuille de style
- Écrire le `@custom-variant dark` de Tailwind sur **exactement** le sélecteur passé en `darkModeSelector`, dans le même commit (cf. [tailwindcss/setup.md](../tailwindcss/setup.md))

## À éviter
- Copier une configuration PrimeNG issue d'un projet en v21 : la base rem, les icônes et la licence ont toutes changé
- Le preset `aura-compat` par confort : il fige le calibrage 14px que le projet a explicitement écarté
- Écrire du CSS ciblant les classes internes des composants hors de la clé `css` du preset : il casse à la première montée de version sans point unique à relire
- Ouvrir une issue sur le dépôt GitHub `primefaces/primeng` en attendant une réponse : il ne porte plus que la lignée MIT 21.x en correctifs de sécurité, issues en lecture seule. Le code 22.x vit dans un dépôt privé, le support passe par PrimeUI

> Le câblage de `providePrimeNG()` (preset importé, valeurs exactes de `darkModeSelector` et de `cssLayer`) est dans [angular/app-config.md](../angular/app-config.md), qui porte le bootstrap.

## Gotchas
- La clé passe par `providePrimeNG({ license })`, injectée au build par `--define` depuis `PRIMENG_LICENSE_KEY` (dotenv en local, secret en CI), jamais par `environments/` versionné
- Sans clé valide, les composants affichent une notice de licence **y compris en développement** : la webview Tauri n'est pas exemptée
- La base rem est passée de 14px à 16px en v22 : tout style maison calé sur 14px se retrouve décalé- `prefix: 'p'` fixe le préfixe des variables CSS (`--p-primary-color`), consommées aussi côté Tailwind par `tailwindcss-primeui`

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
