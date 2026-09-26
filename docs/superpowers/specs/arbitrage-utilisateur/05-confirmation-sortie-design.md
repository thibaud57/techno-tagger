---
feature: "Feature 3 : Arbitrage utilisateur"
subproject: "confirmation-sortie"
goal: "Demander confirmation à la fermeture de la fenêtre dès qu'un travail n'est pas terminé, quel que soit l'onglet qui l'a lancé : extraction de playlist, run de tagging ou arbitrages en attente"
status: "draft"
complexity: "M"
tdd_scope: "partial"
depends_on: ["03-service-arbitrage-ui-design.md"]
date: "2026-09-26"
---

# Confirmation de sortie

## Scope

Couvre une garde de fermeture unique dans `core`, qui agrège les travaux en cours (extraction, run de tagging, arbitrages en attente) et que les Features 4 et 5 étendront d'une ligne chacune ; l'interception de la fermeture de la fenêtre côté webview par l'API fenêtre de Tauri, derrière un jeton injectable ; la modale qui nomme le travail en cours et propose de rester ou de quitter ; la permission de capability qui rend la fermeture possible une fois interceptée ; et les docs qui élargissent la confirmation à l'extraction.

Exclut la reprise d'un travail interrompu (Feature 6), l'arrêt propre du sidecar à la fermeture (Tauri le termine, ARCHITECTURE.md § API) et toute logique dans `src-tauri/src/`. Chevauche la Feature 1 sur l'extraction : absorbé ici sur décision du 2026-09-26, une seule garde pour toute l'application.

### État livré

À la fin de ce sub-project, on peut : sous `tauri dev`, fermer la fenêtre pendant une extraction, pendant un run ou avec des arbitrages en attente et voir la confirmation qui nomme ce travail ; « Rester » garde l'application ouverte, « Quitter quand même » la ferme ; sans travail en cours, la fenêtre se ferme directement ; et lancer `pnpm exec ng test --watch=false` pour voir passer la garde sur une fenêtre simulée.

## Dependencies

- `03-service-arbitrage-ui-design.md` (statut: draft) : `SidecarService.arbitrationCount`, à côté des signaux déjà livrés `SidecarService.extracting` et `SidecarService.tagging`.

## Références de design

- **Design system** : fiche `components/overlay/ConfirmDialog`, sous `.design-sync/design-system/`, qui réserve `p-confirmdialog` et son bouton `danger` aux trois actions sur les fichiers musicaux ; la confirmation de sortie n'en fait pas partie et prend un `p-dialog`. Aucun écran de maquette ne la montre.
- Règle de lecture : `.claude/rules/design/claude-design.md`

## Files touched

- **À créer** : `src/app/core/app-window.ts` (jeton `APP_WINDOW` et fenêtre Tauri de production)
- **À créer** : `src/app/core/close-guard.service.ts`
- **À créer** : `src/app/core/close-guard.service.spec.ts`
- **À créer** : `src/app/shared/components/close-confirmation.component.ts`
- **À créer** : `src/app/shared/components/close-confirmation.component.spec.ts`
- **À modifier** : `src/app/app.component.ts`, `src/app/app.component.html` (installation de la garde, montage de la confirmation hors des deux branches)
- **À modifier** : `src/app/app.component.spec.ts` (créé par le sub-project 04 : installation de la garde)
- **À modifier** : `src-tauri/capabilities/default.json` (`core:window:allow-destroy`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (bloc `app.close.*`)
- **À modifier** : `docs/DESIGN.md` (§ Mapping Composants > Navigation : confirmation de sortie)
- **À modifier** : `docs/BRAINSTORM.md` (Feature 3 : confirmation élargie à l'extraction et au run)
- **À modifier** : `docs/adrs/009-enchainement-sources-et-arbitrage.md` (note complémentaire : la confirmation de sortie couvre tout travail en cours)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : écran absent de la maquette)

## Architecture approach

- **Jeton `APP_WINDOW`** (`core/app-window.ts`), sur le modèle de `SIDECAR_TRANSPORT` : `InjectionToken` fourni à la racine par une fabrique, d'interface `onCloseRequested(handler)` et `destroy()`. La fabrique enveloppe `getCurrentWindow()` de `@tauri-apps/api/window`. Hors Tauri (`ng serve`, Playwright), l'inscription échoue et le jeton l'absorbe, comme `pickPath` : l'écran reste utilisable (`.claude/rules/typescript/types.md`, frontière testable).
- **`CloseGuard`** (`core/close-guard.service.ts`, `.claude/rules/angular/services.md`) :
  - `pendingWork` : `computed` qui liste les travaux en cours par clé, dans un ordre fixe : `extraction` (`SidecarService.extracting`), `tagging` (`SidecarService.tagging`), `arbitration` (`arbitrationCount > 0`), avec le nombre d'arbitrages. Une Feature suivante y ajoute sa ligne sans toucher au reste ;
  - `install()` : s'inscrit une seule fois sur la fermeture. Travail en cours : `preventDefault()` appelé de façon synchrone, avant toute attente, puis ouverture de la confirmation avec un instantané de `pendingWork` pris à cet instant. Rien en cours : la fermeture suit son cours ;
  - `request` : l'instantané en lecture, `null` hors confirmation ; `stay()` le remet à `null` ; `leave()` appelle `destroy()`, qui ferme sans repasser par la garde.
- **Instantané plutôt que suivi en direct** : la confirmation dit ce qui était en cours quand l'utilisateur a demandé à quitter. Un travail qui s'achève pendant qu'il lit ne fait ni disparaître une ligne sous ses yeux ni fermer l'application à sa place.
- **`CloseConfirmationComponent`** (`shared/components/`) : `p-dialog` modal, largeur bornée et mesurée sur le plus long message en FR et en EN (arbitrage « Largeurs »). Titre H3 `text-lg font-semibold`, une phrase par travail de l'instantané, pied « Quitter quand même » (`outlined`, `secondary`) puis « Rester » (primary, focus à l'ouverture). La croix et Échap valent « Rester ». Aucun `danger` : la sortie ne touche aucun fichier musical (DESIGN.md § Palette > Règles).
- **Messages**, bloc `app.close.*` (`.claude/rules/ngx-translate/i18n.md`) :
  - `extraction` : la copie est coupée et un fichier peut rester à moitié écrit dans la destination, Tauri terminant le sidecar sans `shutdown` (ARCHITECTURE.md § API) ;
  - `tagging` : la recherche s'arrête et ses résultats sont perdus ;
  - `arbitration` : le nombre d'arbitrages en attente, perdus.
  « Perdus » : rien n'est persisté avant la Feature 6 (ADR-010).
- **Shell** : `AppComponent` appelle `install()` dans son constructeur et monte la confirmation hors des deux branches de son template, écran bloquant compris. Sidecar mort, `extracting` et `tagging` sont retombés et la file est vide : la fenêtre se ferme sans demander.
- **Capability** (`.claude/rules/tauri/capabilities.md`) : un écouteur de `onCloseRequested` prend la fermeture à son compte et la termine par `destroy()`. Sans `core:window:allow-destroy`, absent de `core:default`, la fenêtre ne se fermerait plus du tout. L'identifiant se vérifie par `tauri permission ls`. Aucune ligne dans `src-tauri/src/`, qui reste à l'initialisation des plugins.

## Acceptance criteria

### Scénario 1 : Rien en cours
**GIVEN** aucune extraction, aucun run et une file d'arbitrage vide
**WHEN** l'utilisateur ferme la fenêtre
**THEN** elle se ferme, sans confirmation

### Scénario 2 : Extraction en cours
**GIVEN** une extraction en cours
**WHEN** l'utilisateur ferme la fenêtre, puis clique « Rester »
**THEN** la confirmation annonce que la copie sera coupée et qu'un fichier peut rester à moitié écrit
**AND** l'application reste ouverte et l'extraction continue

### Scénario 3 : Run et arbitrages
**GIVEN** un run en cours et deux arbitrages en attente
**WHEN** l'utilisateur ferme la fenêtre, puis clique « Quitter quand même »
**THEN** la confirmation nomme le run, puis les deux arbitrages, dans cet ordre
**AND** l'application se ferme

### Scénario 4 : Croix
**GIVEN** la confirmation ouverte
**WHEN** l'utilisateur la ferme par la croix ou par Échap
**THEN** l'application reste ouverte

### Scénario 5 : Écran bloquant
**GIVEN** le sidecar mort, écran bloquant affiché
**WHEN** l'utilisateur ferme la fenêtre
**THEN** elle se ferme, sans confirmation

## Tests à écrire

### Unit
- `src/app/core/close-guard.service.spec.ts` :
  - lets the window close when no work is pending
  - holds the window and asks for confirmation while work is pending (paramétré : extraction, run, arbitrages)
  - lists the pending work in a fixed order
  - closes the window for good when the user leaves
  - keeps the window open when the user stays
  - installs its listener only once
  - stays silent outside Tauri
  - keeps the snapshot when the work ends during the confirmation
  - replaces the snapshot when closing is asked again
  - reopens the application when the window refuses to close
- `src/app/shared/components/close-confirmation.component.spec.ts` :
  - names every pending work
  - leaves the application only on the leave button
  - stays when the cross is used
  - puts the focus on the stay button
- `src/app/app.component.spec.ts` :
  - installs the close guard at startup

La fenêtre est simulée à sa frontière par `APP_WINDOW`, comme le transport du sidecar par `SIDECAR_TRANSPORT`. Aucun test ne vérifie Tauri ni PrimeNG : la vraie fermeture se vérifie sous `tauri dev`, c'est l'état livré.

## Edge cases

- **Fermeture redemandée pendant la confirmation** : retenue de nouveau, l'instantané est remplacé par le nouveau.
- **Travail qui s'achève pendant la confirmation** : l'instantané ne bouge pas ; « Quitter quand même » ferme, « Rester » garde ouvert.
- **Fermeture par Alt+F4 ou par la barre des tâches** : même événement de fermeture, même garde.
- **Mise à jour de l'application** : l'updater ferme l'application avant d'installer (`docs/knowledges/tauri.md`) ; sa vérification a lieu au démarrage, hors de tout run, et ne passe pas par cette garde.
- **`destroy()` refusé** (capability manquante) : l'erreur est journalisée en console, la confirmation se referme et l'application reste ouverte plutôt que figée.

## Architectural decisions

### Décision : Composant de la confirmation

**Options envisagées :**
- **A. `p-dialog`, « Quitter quand même » en `secondary`** : même composant que la modale d'arbitrage, sans `ConfirmationService`, rouge réservé aux actions sur les fichiers.
- **B. `p-confirmdialog`, « Quitter » en `danger`** : le rouge dit le risque de fichier coupé, mais contredit la fiche ConfirmDialog et DESIGN.md § Palette.
- **C. `p-confirmdialog`, « Quitter » en `secondary`** : composant natif, `ConfirmationService` à fournir à la racine.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- La fiche ConfirmDialog réserve le composant au point de non-retour sur les fichiers musicaux ; la sortie n'en est pas un, même si une copie coupée peut laisser un fichier incomplet dans la destination, que le texte annonce.

### Décision : Où vit la garde

**Options envisagées :**
- **A. Un `CloseGuard` dans `core` et un jeton `APP_WINDOW`** : testable sans Tauri, et les Features 4 et 5 ajoutent leur travail à une seule liste.
- **B. Tout dans `AppComponent`** : moins de fichiers, mais la fenêtre Tauri n'est plus simulable et la liste des travaux se disperse dans le shell.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26 : une garde factorisée pour toute l'application, extraction comprise.
- Même frontière que le sidecar : ce qui touche Tauri passe par un jeton injectable, simulé en test.
