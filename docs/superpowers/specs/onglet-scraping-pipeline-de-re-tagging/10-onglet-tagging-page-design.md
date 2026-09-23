---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "onglet-tagging-page"
goal: "Livrer l'écran de l'onglet Tagging, du choix du dossier à la fin de la phase réseau"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["05-cle-api-design.md", "08-service-sidecar-tagging-design.md", "09-liste-du-run-design.md"]
date: "2026-09-20"
---

# Onglet Tagging : dossier, lancement, progression et fin de run

## Scope

Couvre l'écran de l'onglet Tagging : choix du dossier à re-tagger, lancement du run et ses conditions, barre de progression de la phase réseau, liste du run, état vide, erreurs du sidecar. Couvre aussi le signal de fin, un service partagé qui joue deux notes courtes puis affiche un toast, branché sur la fin de la phase réseau **et** sur la fin de l'extraction de l'onglet Playlist, ainsi que la trace de cette extension dans BRAINSTORM.md. Couvre enfin le passage d'un onglet à l'autre : le bouton « Passer au tagging » que l'onglet Playlist affiche une fois l'extraction terminée, et qui ouvre l'onglet Tagging sur le dossier tout juste extrait.

Exclut la bascule du signal sonore et les autres réglages (Feature 7), la modale d'arbitrage (Feature 3), le rattrapage par URL (Feature 4), la confirmation d'écriture (Feature 5), le récapitulatif et la reprise (Feature 6).

### État livré

À la fin de ce sub-project, on peut : ouvrir la fenêtre Tauri, extraire une playlist puis cliquer « Passer au tagging », arriver dans l'onglet Tagging avec le dossier de destination déjà en place (ou y aller par l'onglet et choisir un dossier), lancer le run, voir les lignes se remplir et la barre avancer, puis entendre le signal et voir le toast une seule fois quand la phase réseau se termine.

## Dependencies

- `08-service-sidecar-tagging-design.md` (statut: draft) : `startTagging`, `taggingTracks`, `taggingProgress`, `tagging`, `taggingFinished`.
- `09-liste-du-run-design.md` (statut: draft) : `RunListComponent`.
- `05-cle-api-design.md` (statut: draft) : `apiKeyConfigured`, sans quoi le lancement reste bloqué.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, composant `TaggingScreen` dans ses phases `idle` et `running` (en-tête, chemin, bouton de lancement, barre de progression, bloc vide), `AppShell.jsx` pour l'onglet et le toast de fin de phase réseau, et `PlaylistScreen.jsx` dans son état `done` pour le seul bouton « Passer au tagging » (le reste de cet écran est livré et arbitré, cf. `.design-sync/NOTES.md`). Les phases `urlRescue`, `writing` et `recap`, ainsi que `UrlRescue` et `Recap`, relèvent des Features 4 à 6.
- **Design system** : `components/forms/Button.prompt.md`, `components/data/ProgressBar.prompt.md`, `components/feedback/EmptyState.prompt.md`, `components/feedback/Message.prompt.md`, `components/feedback/Toast.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`, arbitrages dans `.design-sync/NOTES.md` § Reste ouvert (container unique `px-16 py-8` porté par le shell, page qui ne défile jamais, le scroll vit dans la table)

## Files touched

- **À modifier** : `src/app/features/tagging/tagging-page.component.ts`, `.html` (remplacent le stub)
- **À créer** : `src/app/features/tagging/tagging-page.component.spec.ts`
- **À modifier** : `src/app/shared/components/icon.component.ts` (icônes `play` du bouton de lancement et `arrow-right` du passage au tagging, comme la maquette)
- **À créer** : `src/app/core/completion-signal.service.ts` et `completion-signal.service.spec.ts`
- **À modifier** : `src/app/core/preferences.ts` (préférence du signal sonore, dernier dossier de destination)
- **À modifier** : `src/app/app.config.ts` (`MessageService` fourni à la racine : `CompletionSignalService` est `providedIn: 'root'`, un provider posé sur `AppComponent` lui serait invisible), `src/app/app.component.ts`, `src/app/app.component.html` (le `p-toast` du shell)
- **À modifier** : `src/app/features/playlist/playlist-page.component.ts`, `.html` (signal de fin d'extraction, bouton « Passer au tagging »)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json`
- **À modifier** : `docs/BRAINSTORM.md` (Feature 1 : signal de fin d'extraction, ajouté depuis la Feature 2)
- **À modifier** : `.design-sync/NOTES.md` (écarts : sélecteur de dossier, toast partagé)

## Architecture approach

- **Service de signal de fin** `CompletionSignalService` dans `core/` : `announce(messageKey)` joue deux notes courtes par l'API Web Audio, puis affiche un toast traduit par le `MessageService` de PrimeNG. Aucun fichier audio n'entre dans le dépôt : pas de binaire à relire en diff, pas de licence à suivre, et le remplacement par un fichier plus tard ne touchera que ce service (décision du 2026-09-20). La politique d'autoplay de WebView2 est satisfaite, le son ne suivant qu'un clic de l'utilisateur sur « Lancer ».
- **Le son respecte la préférence** « signal sonore », lue dans le store Tauri avec `true` par défaut, sur le modèle du mode d'extraction déjà persisté. Sa bascule arrive avec la Feature 7. Le toast, lui, s'affiche toujours : il n'est pas sonore et ne coupe rien.
- **Déclenché par une transition, jamais par un rendu** : le passage de la fin de phase réseau de nul à renseigné déclenche l'annonce une seule fois, même si l'écran se recompose. BRAINSTORM l'exige : une fois, à la fin de la phase réseau, jamais par arbitrage.
- **Branché des deux côtés** (décision du 2026-09-20) : fin de la phase réseau du run, et fin de l'extraction de l'onglet Playlist, qui n'avait ni son ni toast. C'est une extension de la Feature 1, consignée dans BRAINSTORM.md sous celle-ci. Le `p-toast` est posé une fois dans le shell, la Feature 4 le réutilisera pour le rattrapage.
- **Choix du dossier par `PathPickerComponent`** (décision du 2026-09-20, écart à la maquette) : la maquette n'a pas de sélecteur et renvoie vers l'onglet Playlist, BRAINSTORM demande « la sélection d'un dossier ». Le sélecteur est prérempli avec la destination de la dernière extraction quand il y en a une, ce qui couvre le cas courant sans interdire de re-tagger un dossier qui ne vient pas d'une extraction. L'écart est consigné dans `.design-sync/NOTES.md`.
- **Passage au tagging depuis l'onglet Playlist** (décision du 2026-09-22) : une fois l'extraction terminée, un bouton secondaire « Passer au tagging » navigue vers l'onglet Tagging par le `Router`, comme le shell le fait pour ses onglets. Il ne transporte aucune donnée : le dossier arrive par la destination mémorisée à l'extraction, celle-là même qui préremplit le sélecteur. Absent avant et pendant une extraction. La maquette le place à côté de l'action d'extraction ; l'écran livré ayant replié son formulaire en deux temps (arbitrage consigné dans `.design-sync/NOTES.md`), il prend place à côté de « Extraction terminée (N sur N) », sur la même ligne.
- **Lancement conditionné**, comme le bouton d'extraction déjà livré : désactivé sans dossier, sans clé API (`apiKeyConfigured`), pendant un run, ou tant que le sidecar n'est pas prêt. Son tooltip nomme ce qui manque, seule exception admise par DESIGN.md à la règle « un tooltip n'est jamais seul porteur d'information ».
- **Progression** par `PhaseProgressComponent`, alimentée par le signal du store : libellé de phase et compteur traités sur total. Elle disparaît à la fin du run, les états des lignes portant alors l'information.
- **La page ne calcule rien** : lignes, états, scores et compteurs viennent du sidecar (`.claude/rules/angular/components.md`). Elle compose le sélecteur, le bouton, la progression, la liste et les messages.
- **État vide** par `EmptyStateComponent` avant le premier run : invitation à choisir un dossier, ou renvoi vers les Réglages quand aucune clé n'est enregistrée.
- **Erreurs** par `ErrorMessageComponent` sous l'en-tête, traduites depuis leur `code` : `api_key_missing`, `api_key_rejected`, `tagging_folder_unreadable`, `tagging_in_progress`, `sidecar_unavailable`.
- **Layout** : le container et les marges viennent du shell, la page ne pose ni padding ni `max-width`, et ne défile jamais, le scroll vivant dans la table (`.design-sync/NOTES.md` § Reste ouvert).
- **i18n** : aucun libellé en dur, FR et EN dans le même commit, vouvoiement pour les phrases, infinitif pour les actions, espace insécable avant les deux-points en français.

## Acceptance criteria

### Scénario 1 : Dossier prérempli après une extraction
**GIVEN** une extraction terminée vers `D:\Sets\Août`
**WHEN** l'onglet Tagging s'ouvre
**THEN** le sélecteur de dossier affiche ce chemin
**AND** le bouton de lancement est actif si une clé est enregistrée

### Scénario 2 : Lancement impossible
**GIVEN** aucun dossier choisi, ou aucune clé enregistrée
**WHEN** l'écran est affiché
**THEN** le bouton de lancement est désactivé
**AND** son tooltip nomme ce qui manque

### Scénario 3 : Run lancé
**GIVEN** un dossier choisi et une clé enregistrée
**WHEN** l'utilisateur clique sur « Lancer le run »
**THEN** la commande part avec ce dossier
**AND** la barre de progression apparaît et les lignes se remplissent

### Scénario 4 : Fin de la phase réseau
**GIVEN** un run en cours
**WHEN** la phase réseau se termine
**THEN** le signal sonore est joué une seule fois et un toast s'affiche
**AND** la barre de progression disparaît

### Scénario 5 : Signal sonore désactivé
**GIVEN** la préférence de signal sonore à faux
**WHEN** la phase réseau se termine
**THEN** aucun son n'est joué
**AND** le toast s'affiche quand même

### Scénario 6 : Fin d'extraction
**GIVEN** une extraction lancée depuis l'onglet Playlist
**WHEN** elle se termine
**THEN** le même signal et un toast annoncent la fin

### Scénario 7 : Clé refusée pendant le run
**GIVEN** un run arrêté par trois refus de la clé
**WHEN** l'erreur arrive
**THEN** elle s'affiche traduite sous l'en-tête
**AND** le bouton de lancement redevient actif

### Scénario 8 : Passage au tagging
**GIVEN** une extraction terminée vers `D:\Sets\Août` dans l'onglet Playlist
**WHEN** l'utilisateur clique sur « Passer au tagging »
**THEN** l'onglet Tagging s'ouvre
**AND** son sélecteur de dossier affiche `D:\Sets\Août`

### Scénario 9 : Pas de passage sans extraction terminée
**GIVEN** aucune extraction lancée, ou une extraction en cours
**WHEN** l'onglet Playlist est affiché
**THEN** le bouton « Passer au tagging » est absent

## Tests à écrire

### Unit
- `src/app/core/completion-signal.service.spec.ts` :
  - plays a sound and shows a toast when the run ends
  - stays silent when the sound preference is off but still shows the toast
- `src/app/features/tagging/tagging-page.component.spec.ts` :
  - disables the launch without a folder, without an api key, or during a run (paramétré)
  - sends the start tagging command with the chosen folder
  - prefills the folder with the destination of the last extraction
  - announces the end of the network phase only once
- `src/app/features/playlist/playlist-page.component.spec.ts` (ajout) :
  - announces the end of the extraction
  - navigates to the tagging tab when asked to go on with the extracted folder

Aucun test ne vérifie le rendu conditionnel d'un bloc ni PrimeNG : ce qui est testé est la disponibilité de l'action, la commande émise et le déclenchement unique du signal.

## Edge cases

- **Web Audio indisponible** (contexte refusé par la webview) : l'annonce se poursuit sans son, le toast s'affiche, aucune erreur visible.
- **Dossier disparu entre le choix et le lancement** : le sidecar répond `tagging_folder_unreadable`, affiché sous l'en-tête.
- **Run relancé sur le même dossier** : les lignes précédentes disparaissent dès l'envoi de la commande, le store étant réinitialisé.
- **Onglet quitté pendant un run** : le run continue, la progression et les lignes sont retrouvées au retour, l'état vivant dans le store.
- **Fin de phase réseau alors que des morceaux attendent un arbitrage** : le signal se déclenche quand même, comme le veut BRAINSTORM, l'arbitrage n'étant pas la phase réseau.
- **Deux fins coup sur coup** (extraction puis run) : deux annonces distinctes, chacune déclenchée par sa transition.

## Architectural decisions

### Décision : Choix du dossier à re-tagger

**Options envisagées :**
- **A. Sélecteur prérempli avec la destination de la dernière extraction** : couvre le cas courant et permet de re-tagger un dossier quelconque.
- **B. Dossier hérité de l'onglet Playlist, sans sélecteur, comme la maquette** : un écran de moins à remplir, mais impossible de re-tagger un dossier qui ne vient pas d'une extraction.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20. BRAINSTORM décrit la sélection d'un dossier comme la première capacité de la feature.
- L'écart à la maquette est consigné dans `.design-sync/NOTES.md` plutôt que tranché en silence.

### Décision : Forme et portée du signal de fin

**Options envisagées :**
- **A. Bip synthétisé par Web Audio, service partagé, branché sur le run et sur l'extraction** : aucun binaire ni licence dans un dépôt public, une seule implémentation pour les deux écrans, remplaçable par un fichier sans toucher aux écrans.
- **B. Fichier audio commité** : son choisi, mais un binaire non relisible en diff et à produire avec un outil externe.
- **C. Signal sur le seul re-tagging** : conforme à la lettre de BRAINSTORM, mais l'extraction reste sans retour de fin.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20.
- L'extraction n'avait ni son ni toast : livrer les deux côtés d'un coup évite d'écrire deux fois la même mécanique, et l'ajout à la Feature 1 est consigné dans BRAINSTORM.md.
