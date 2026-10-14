---
feature: "Feature 7 : Settings"
subproject: "langue-et-signal-sonore"
goal: "Permettre de forcer la langue FR ou EN et de couper le signal sonore de fin depuis les Réglages, choix persistés, dans une page passée en menu latéral"
status: "draft"
complexity: "M"
tdd_scope: "partial"
depends_on: []
date: "2026-10-14"
---

# Langue et signal sonore

## Scope

Ce sub-project passe la page des Réglages en menu latéral : sous le titre, un menu des sections à gauche, la seule section choisie à droite. Il ajoute la section Interface avec deux rangées :
- Langue : bascule immédiate, choix persisté qui prime sur la locale système aux lancements suivants ;
- Signal sonore de fin : coupe le bip, le toast de fin reste.

Les sections API et Administration existantes y passent telles quelles. Il exclut les seuils (sub-project 03, qui ajoute l'entrée Matching), le cache et les logs (sub-project 04).

### État livré

À la fin de ce sub-project, on peut, dans la fenêtre Tauri à 1024 × 700 :
1. passer d'une section à l'autre par le menu, une seule section affichée, sans défilement ;
2. choisir « English » et voir l'interface basculer sans redémarrage, puis la retrouver en anglais au relancement malgré une locale système `fr` ;
3. couper le signal sonore et constater qu'une extraction se termine sur son toast, sans bip.

## Dependencies

Aucune : ce sub-project est autoporté.

## Références de design

- **Maquette** : `SettingsScreen`, section Interface, rangées « Langue » et « Signal sonore de fin ». Disposition remplacée par le menu latéral (décision ci-dessous). Les rangées « Mode agent IA » et « Motif de renommage » et le message sur le thème ne sont pas repris : écartés à la décomposition, leur retrait de la maquette est au Reste ouvert de `.design-sync/NOTES.md`.
- **Design system** : fiches `components/forms/Select`, `components/forms/ToggleSwitch`, `components/forms/SettingsRow`.
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À modifier** : `src/app/features/settings/settings-page.component.ts` (section active, menu, langue, son)
- **À modifier** : `src/app/features/settings/settings-page.component.html` (grille menu et section, section Interface)
- **À modifier** : `src/app/features/settings/settings-page.component.spec.ts` (menu, langue, son ; tests des rangées Administration ouvrant d'abord leur section)
- **À modifier** : `src/app/core/platform/preferences.ts` (préférence `language`, commentaire « sans appelant » de `writeSoundSignal` retiré)
- **À modifier** : `src/app/core/platform/preferences.spec.ts`
- **À modifier** : `src/app/core/i18n/language.ts` (`resolveStartupLanguage`)
- **À modifier** : `src/app/core/i18n/language.spec.ts`
- **À modifier** : `src/app/app.config.ts` (initialiseur de langue)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.interface.*`)
- **À modifier** : `docs/DESIGN.md` (la ligne « Réglages » de § Structure de Page est déjà posée, au réalignement de la maquette du 2026-10-14) :
  - § Mapping : Navigation des Réglages, Langue, Bascules des Réglages (retirées de « Post-MVP (non installés) ») ;
  - § Scale Typographique l.33 : sections des Réglages.
- **À modifier** : `docs/ARCHITECTURE.md` (l.385 : `store`, langue livrée ; l.414 : `features/settings/`, « copie ou déplacement » retiré, il reste sur Playlist)
- **À modifier** : `docs/PRODUCTION.md` (l.242 : langue dans le tableau de la configuration runtime)

## Architecture approach

### Disposition : menu latéral

- Sous le `h1`, une grille à deux colonnes : le menu, puis la section choisie (son `h2` et ses rangées). La colonne du menu prend la largeur du composant, plus large seulement si un libellé l'exige : aucune largeur figée à remesurer (arbitrage « Largeurs »). Le contrôle dans la fenêtre vérifie que « Administration » n'y est pas coupé.
- Le menu est un `p-menu` (composant PrimeNG d'abord, `.claude/rules/primeng/composants.md`). Son modèle est un `computed` qui lit `currentLang()`, comme `pastRunOptions`, pour se retraduire au changement de langue. Chaque entrée pose la section par `command`, l'entrée active est marquée par sa classe d'item, en tokens (`bg-emphasis`, `.claude/rules/tailwindcss/utilitaires.md`).
- La section active est un `signal` local de la page, API par défaut. Pas de route par section : aucun lien ne vise une section, et le composant d'onglet est recréé à chaque visite.
- Entrées livrées ici, dans l'ordre de la maquette : API, Interface, Administration. Le sub-project 03 insère Matching entre API et Interface. Une entrée sans rangée n'existe jamais.
- La section ne défile pas : la plus haute, Administration une fois complète (quatre rangées), tient dans la hauteur du plancher de 700px.

### Langue

- Préférence `language` dans `preferences.ts`, par `definePreference<Language | null>`. Elle vaut `null` tant que l'utilisateur n'a rien choisi, et son filtre `accept` n'admet que les valeurs de `LANGUAGES`.
- `resolveStartupLanguage(readStored, resolveSystem)` dans `core/i18n/language.ts` rend le choix enregistré, sinon `resolveInitialLanguage()`. `readStored` est passé par l'appelant (`readLanguage`) : `preferences.ts` importe déjà `LANGUAGES` de `language.ts`, l'import inverse ferait un cycle. L'initialiseur d'`app.config.ts` l'appelle à la place de `resolveInitialLanguage()` (`.claude/rules/ngx-translate/i18n.md`, `.claude/rules/angular/app-config.md`).
- Rangée Langue : `p-select` `size="small"`, deux options libellées dans leur propre langue (« Français », « English »), identiques dans les deux fichiers de traduction. Largeur fixe mesurée sur « Français », sans les 12rem de la maquette. Aide sous le contrôle, deux lignes : effet immédiat, puis langue du système au premier lancement.
- Le choix part de l'événement de changement du select, jamais d'un `effect` : ouvrir la page ne doit pas enregistrer la langue détectée comme un choix. Au changement : `translate.use()`, puis écriture de la préférence. `app.component.ts` suit déjà `currentLang()` pour l'attribut `lang` du document.

### Signal sonore

- Rangée Signal sonore de fin : `p-toggleswitch` à droite, aide sur sa ligne, comme le bouton seul de la rangée Restauration (arbitrage « Rangée de Réglages »). L'aide nomme les quatre fins qui sonnent : extraction, recherche, écriture, restauration.
- État initial lu par `readSoundSignal()` au montage. Le changement appelle `writeSoundSignal()`, dont le commentaire « sans appelant » part. `CompletionSignalService` relit la préférence à chaque annonce : l'effet est immédiat, le toast reste affiché dans tous les cas.

### Rules applicables

`.claude/rules/angular/components.md`, `.claude/rules/angular/forms.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/tests.md`, `.claude/rules/angular/app-config.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/primeng/theming.md`, `.claude/rules/tailwindcss/echelles.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/typescript/types.md`, `.claude/rules/tauri/capabilities.md`, `.claude/rules/design/claude-design.md`.

## Acceptance criteria

### Scénario 1 : une section à la fois
**GIVEN** la page des Réglages ouverte
**WHEN** l'utilisateur choisit « Administration » dans le menu
**THEN** les rangées Restauration et Runs passés s'affichent
**AND** la rangée Clé API n'est plus affichée

### Scénario 2 : section par défaut
**GIVEN** l'onglet Réglages ouvert depuis un autre onglet
**WHEN** la page s'affiche
**THEN** la section API est affichée et marquée active dans le menu

### Scénario 3 : bascule de langue
**GIVEN** l'interface en français
**WHEN** l'utilisateur choisit « English » dans la rangée Langue
**THEN** l'interface passe en anglais sans redémarrage
**AND** la préférence `language` vaut `en`

### Scénario 4 : le choix prime au lancement
**GIVEN** la préférence `language` à `en` et une locale système `fr-FR`
**WHEN** l'application démarre
**THEN** l'interface s'affiche en anglais

### Scénario 5 : sans choix, la locale décide
**GIVEN** aucune préférence `language` enregistrée et une locale système `fr-BE`
**WHEN** l'application démarre
**THEN** l'interface s'affiche en français
**AND** ouvrir les Réglages n'enregistre aucune préférence `language`

### Scénario 6 : couper le son
**GIVEN** le signal sonore actif
**WHEN** l'utilisateur coupe la bascule Signal sonore de fin
**THEN** la préférence `sound_signal` vaut `false`
**AND** la fin suivante d'une phase longue affiche son toast sans bip

### Scénario 7 : état du son au montage
**GIVEN** la préférence `sound_signal` à `false`
**WHEN** l'utilisateur ouvre la section Interface
**THEN** la bascule est coupée

## Tests à écrire

### Unit
- `src/app/core/i18n/language.spec.ts` :
  - le choix enregistré prime sur la locale système
  - sans choix enregistré, la locale système décide
- `src/app/core/platform/preferences.spec.ts` :
  - la préférence de langue retombe sur `null` pour une valeur hors de `LANGUAGES`
- `src/app/features/settings/settings-page.component.spec.ts` :
  - la section API est affichée par défaut
  - choisir une entrée du menu n'affiche que sa section
  - choisir English bascule la langue et enregistre `en`
  - ouvrir la page n'enregistre aucune langue
  - couper le son enregistre `false`
  - la bascule reflète un son coupé enregistré
  - les tests existants des rangées Restauration et Runs passés ouvrent d'abord la section Administration

## Edge cases

- **Store indisponible (`ng serve` seul)** : `definePreference` retombe sur ses défauts sans lever, la langue suit la locale et le son reste actif. Un choix fait dans la page s'applique à la session sans être retenu.
- **Préférence éditée à la main** : une langue inconnue retombe sur `null`, donc sur la locale système.
- **Bascule pendant un run** : changer la langue retraduit l'écran en cours, les libellés venant tous de clés et les erreurs du sidecar de `code` + `params` ; les rapports et les logs restent en anglais.
- **Erreur affichée dans une section masquée** : une erreur de `set_api_key` ou de `rollback` reste attachée à sa rangée, par `errorFor`, et réapparaît quand sa section est rouverte, tant qu'aucune autre commande ne l'a remplacée.

## Architectural decisions

### Décision : disposition de la page des Réglages

**Options envisagées :**
- **A. La page défile** : ordre et rendu de la maquette, mais seule exception à « la page ne défile jamais » (DESIGN.md § Structure de Page).
- **B. Sous-onglets horizontaux** : rien ne défile, mais une barre d'onglets de plus sous celle du shell.
- **C. Menu latéral, une section à la fois** : rien ne défile, les sections restent listées d'un coup d'œil, mais la maquette est à reprendre.
- **D. Menu latéral et colonne qui défile** : tout accessible d'un geste, mais la page défile.
- **E. Deux colonnes, rangées empilées** : rien à naviguer, mais contraire à l'arbitrage « Rangée de Réglages » et trop étroit à 1024px.

**Choix : C** (choisi par le propriétaire le 2026-10-14 sur une planche des cinq variantes à 1024 × 700)

**Rationale :**
- Neuf rangées font environ 1 070px de contenu pour environ 530px disponibles au plancher : A et D défilent, E déborde.
- C garde la règle du shell intacte et nomme toutes les sections dans le menu.
- La maquette suit la décision (Reste ouvert de `.design-sync/NOTES.md`), DESIGN.md la porte en § Structure de Page, sans arbitrage.

### Décision : moment où la langue s'enregistre

**Options envisagées :**
- **A. Sur l'événement de changement du select** : seul un geste de l'utilisateur enregistre.
- **B. Par un `effect` sur la langue courante** : plus court, mais il enregistre au premier rendu la langue détectée, qui devient un choix figé.

**Choix : A**

**Rationale :**
- Avec B, un utilisateur dont la locale passe de `fr` à `en` resterait en français pour avoir seulement ouvert les Réglages une fois.
