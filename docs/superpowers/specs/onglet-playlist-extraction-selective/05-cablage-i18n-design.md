---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "cablage-i18n"
goal: "Rendre l'interface traduisible dès son premier écran, pour qu'aucun libellé n'ait à être repris ensuite"
status: "draft"
complexity: "S"
tdd_scope: "partial"
depends_on: []
date: "2026-09-08"
---

# Câblage de l'internationalisation et résolution de la langue initiale

## Scope

Couvre les providers ngx-translate dans `app.config.ts`, les deux fichiers de langue servis depuis `public/i18n/`, la résolution de la langue initiale avant le premier rendu, et la reprise des libellés aujourd'hui en dur dans les trois écrans stub et la barre d'onglets. La résolution lit la locale système par le plugin `os` de Tauri, retombe sur celle du navigateur quand l'application tourne hors Tauri, et sur l'anglais en dernier recours.

Exclut le sélecteur de langue et la persistance du choix utilisateur dans le `store`, qui relèvent de la Feature 7 et primeront alors sur la locale système. Exclut les libellés des écrans non encore construits : poser des clés pour des composants qui n'existent pas serait spéculatif.

### État livré

À la fin de ce sub-project, on peut : lancer l'application sur une machine dont la locale commence par `fr` et voir les trois onglets et les titres d'écran en français, la même chose en anglais sur toute autre locale, et plus aucun libellé en dur dans les templates.

## Dependencies

Aucune — ce sub-project est autoporté.

## Files touched

- **À créer** : `src/app/core/language.ts` (type de langue, règle de correspondance BCP-47, résolution de la langue initiale)
- **À créer** : `src/app/core/language.spec.ts`
- **À créer** : `src/app/core/translations.spec.ts` (cohérence des deux fichiers de langue)
- **À créer** : `public/i18n/fr.json`
- **À créer** : `public/i18n/en.json`
- **À modifier** : `src/app/app.config.ts` (providers ngx-translate et initializer de langue)
- **À modifier** : `src/app/app.component.html` (libellés des trois onglets par `TranslatePipe`)
- **À modifier** : `src/app/app.component.ts` (import de `TranslatePipe`)
- **À modifier** : `src/app/features/playlist/playlist-page.component.html` et `.ts`
- **À modifier** : `src/app/features/tagging/tagging-page.component.html` et `.ts`
- **À modifier** : `src/app/features/settings/settings-page.component.html` et `.ts`

## Architecture approach

- **`provideTranslateService()` et `provideTranslateHttpLoader({ prefix: '/i18n/', suffix: '.json' })`** dans `app.config.ts`. `HttpClient` est fourni d'office en Angular 22 : `provideHttpClient()` ne s'ajoute pas (cf. `.claude/rules/angular/app-config.md`). Le `prefix` pointe sur `public/i18n/`, servi à la racine par la configuration d'assets d'`angular.json`.
- **`failOnError: true` en développement** : un fichier de traduction absent rend `{}` avec un simple avertissement, si bien qu'un `prefix` erroné produit une interface où toutes les clés s'affichent brutes, sans rien signaler.
- **Langue résolue avant le premier rendu par `provideAppInitializer()`** : `locale()` du plugin Tauri est asynchrone quand les providers sont synchrones. Un initializer qui rend une promesse retarde le bootstrap jusqu'à ce que la langue soit posée, ce qui évite un premier rendu dans la mauvaise langue suivi d'une bascule visible.
- **Trois niveaux de repli, dans l'ordre** : la locale système par `locale()` du plugin `os`, puis `navigator.language`, puis l'anglais. Le deuxième niveau existe parce que `invoke()` de Tauri appelle `window.__TAURI_INTERNALS__` sans garde : hors Tauri, sous le `ng serve` seul de `just dev-ui`, l'appel rejette avec une `TypeError`. Sans ce repli, l'interface s'afficherait en anglais sur une machine française dès qu'on développe la webview seule.
- **Correspondance sur le préfixe du tag BCP-47** : un tag commençant par `fr` donne le français, tout le reste l'anglais. La comparaison porte sur le préfixe et non sur l'égalité, `fr-FR`, `fr-BE` et `fr` devant tous donner le même résultat.
- **Règle de correspondance isolée en fonction pure** : la composition des deux API n'est documentée ni côté Tauri ni côté ngx-translate, ce que la rule signale et demande de couvrir par un test. Séparer la règle de son approvisionnement la rend testable sans lancer Tauri ni simuler un navigateur.
- **Clés structurées par feature**, en miroir de l'arborescence des composants : un espace de noms pour la navigation, un par écran. Les deux fichiers de langue restent synchronisés dans le même commit, une clé ajoutée d'un seul côté produisant du texte anglais au milieu d'une interface française.
- **`TranslatePipe` importé composant par composant** : il n'existe plus de module en v18. Les libellés passent par `[translate]` ou par le pipe, jamais par le texte de l'élément comme clé, forme dépréciée.
- **« Playlist » et « Tagging » restent identiques dans les deux langues** : ce sont les mots employés tels quels par le public visé, et « liste de lecture » ou « étiquetage » désigneraient moins clairement la même chose. Aucune règle du projet n'impose ce choix, c'est un arbitrage de vocabulaire produit. Seul « Settings » devient « Réglages », qui est le mot français usuel d'une interface.
- **Aucune permission à ajouter** : `os:allow-locale` figure déjà dans `src-tauri/capabilities/default.json`.

## Acceptance criteria

### Scénario 1 : Locale française
**GIVEN** une machine dont la locale système est `fr-FR`
**WHEN** l'application démarre
**THEN** la langue retenue est le français
**AND** les trois onglets et le titre de l'écran s'affichent en français

### Scénario 2 : Locale non française
**GIVEN** une machine dont la locale système est `de-DE`
**WHEN** l'application démarre
**THEN** la langue retenue est l'anglais

### Scénario 3 : Variante régionale du français
**GIVEN** une locale système valant `fr-BE`
**WHEN** la langue est résolue
**THEN** le français est retenu, la comparaison portant sur le préfixe du tag et non sur son égalité

### Scénario 4 : Locale système indisponible
**GIVEN** un appel à la locale système qui rend `null`
**WHEN** la langue est résolue
**THEN** la langue du navigateur est consultée
**AND** l'anglais est retenu si elle ne commence pas par `fr`

### Scénario 5 : Application lancée hors Tauri
**GIVEN** une webview servie sans Tauri, où l'appel à la locale système rejette
**WHEN** la langue est résolue
**THEN** aucune erreur ne remonte
**AND** la langue du navigateur décide

### Scénario 6 : Aucune source disponible
**GIVEN** un appel à la locale système qui rejette et une langue de navigateur vide
**WHEN** la langue est résolue
**THEN** l'anglais est retenu

### Scénario 7 : Libellés traduits à l'écran
**GIVEN** l'application démarrée en français
**WHEN** la barre d'onglets et l'écran courant sont rendus
**THEN** aucun libellé en dur ne subsiste dans les templates
**AND** chaque libellé provient d'une clé présente dans les deux fichiers de langue

### Scénario 8 : Fichiers de langue synchronisés
**GIVEN** les deux fichiers de langue
**WHEN** leurs clés sont comparées
**THEN** ils portent exactement le même ensemble de clés

## Tests à écrire

### Unit

- `src/app/core/language.spec.ts` :
  - un tag `fr-FR` donne le français
  - un tag `fr` seul donne le français
  - un tag `fr-BE` donne le français, la comparaison portant sur le préfixe
  - un tag `de-DE` donne l'anglais
  - un tag `en-US` donne l'anglais
  - un tag `null` donne l'anglais
  - une chaîne vide donne l'anglais
  - la casse du tag est sans effet
  - la locale système l'emporte sur celle du navigateur quand elle est disponible
  - un rejet de la locale système fait consulter la langue du navigateur
  - un rejet de la locale système et une langue de navigateur absente donnent l'anglais

Le câblage des providers et le chargement des fichiers par le loader ne sont pas testés : ce sont des comportements de bibliothèque, qu'une mise à jour de dépendance ferait échouer sans qu'aucune règle du projet ait bougé.

## Edge cases

- **Tag BCP-47 exotique** : un tag comme `fr-Latn-FR` commence par `fr` et donne donc le français, ce qui est le comportement voulu.
- **Langue changée pendant l'exécution** : hors scope ici, mais la bascule sans rebuild est déjà permise par ngx-translate. La Feature 7 la déclenchera depuis son sélecteur.
- **Fichier de langue introuvable au démarrage** : `failOnError: true` en développement fait remonter l'erreur au lieu de laisser une interface de clés brutes. En production, l'application s'affiche avec ses clés, ce qui reste préférable à un écran blanc.
- **`navigator.language` absent** : la propriété est universellement disponible dans les navigateurs visés, mais le repli final sur l'anglais couvre le cas sans condition supplémentaire.

## Architectural decisions

### Décision : Résoudre la langue dans un initializer applicatif plutôt qu'au premier rendu

**Options envisagées :**
- **A. `provideAppInitializer()` rendant une promesse** : le bootstrap attend que la langue soit posée. Le premier rendu est déjà dans la bonne langue, et aucun composant n'a à gérer un état « langue inconnue ».
- **B. Résolution dans le composant racine, après le premier rendu** : pas d'attente au démarrage, mais l'interface s'affiche brièvement dans la langue de repli puis bascule, et `currentLang()` vaut `null` pendant ce temps, ce que chaque consommateur devrait alors traiter.

**Choix : A**

**Rationale :**
- Le coût de l'attente est celui d'un appel local à la locale système, sans rapport avec un chargement réseau
- L'option B rend visible une bascule de langue au démarrage, exactement ce qu'un utilisateur lit comme un défaut
- `currentLang` est un `Signal<Language | null>` : le laisser à `null` au premier rendu propagerait la condition dans tous les composants qui le lisent

### Décision : Trois niveaux de repli plutôt que deux

**Options envisagées :**
- **A. Locale Tauri, puis `navigator.language`, puis anglais** : la webview servie seule reste dans la langue de la machine, ce qui garde les libellés français testables pendant le développement de l'interface.
- **B. Locale Tauri, puis anglais** : plus court, mais l'interface passe en anglais dès qu'on la développe hors Tauri, sur une machine pourtant française.

**Choix : A**

**Rationale :**
- `just dev-ui` lance `ng serve` seul et fait partie des modes de travail prévus par le projet : ce n'est pas un cas de bord
- `navigator.language` expose la même locale système que celle qu'interroge Tauri, le repli n'introduit donc aucune divergence de comportement
- Le niveau supplémentaire ne coûte qu'une ligne dans une fonction déjà couverte par des tests
