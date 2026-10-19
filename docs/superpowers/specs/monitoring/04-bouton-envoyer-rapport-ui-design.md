---
feature: "Feature 9 : Monitoring"
subproject: "bouton-envoyer-rapport-ui"
goal: "Poser dans le pied du récapitulatif le bouton « Envoyer ce rapport », qui ouvre dans le navigateur l'issue de retour pré-remplie du run affiché et révèle dans l'Explorateur l'export à y glisser."
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["03-protocole-ndjson-retour-design.md"]
date: "2026-10-16"
---

# Bouton « Envoyer ce rapport »

## Scope

Le récapitulatif, du run courant comme d'un run passé, gagne dans son pied le bouton « Envoyer ce rapport ». Au clic, l'interface demande au sidecar l'issue de retour du run affiché (`prepare_feedback`), puis, à sa réponse, ouvre l'URL dans le navigateur par défaut et révèle l'export dans l'Explorateur. Le sub-project porte aussi les traductions.

Exclus : DESIGN.md et la maquette (export local et Claude Design), mis à jour hors de ce sub-project (décision du propriétaire du 2026-10-16) ; la construction de l'URL et de l'export (`02-issue-de-retour-sidecar`), le contrat NDJSON et les signaux de `SidecarService` (`03-protocole-ndjson-retour`), la vérification sur github.com du formulaire, du label et du glisser-déposer (`05-recette-monitoring`).

### État livré

À la fin de ce sub-project, on peut : ouvrir le récapitulatif d'un run écrit dans `tauri dev`, cliquer « Envoyer ce rapport », voir le spinner, puis le navigateur s'ouvrir sur `issues/new?template=matching-report.yml` du dépôt et l'Explorateur sur l'export sélectionné ; et, sur un run sans rapport, trouver le bouton grisé avec sa raison en tooltip.

## Dependencies

- `03-protocole-ndjson-retour-design.md` (statut: draft) : `SidecarService.prepareFeedback`, `feedbackReady`, `feedbackPending` et l'erreur `prepare_feedback` routée par `errorFor`
- **Prérequis hors feature** : `feature/settings` doit être commitée avant la Feature 9. `settings.admin.starting` (phrase du moteur qui démarre, lue par ce bouton), les modifications de `sidecar.service.ts`, `sidecar-stub.ts`, des fichiers i18n et de `docs/ARCHITECTURE.md` n'existent que dans son working tree au 2026-10-16

## Références de design

- **Maquette** : `ui_kits/techno-tagger/TaggingScreen.jsx`, écran `Recap`, pied (« Retour à la liste » et ligne de contexte). Le bouton en a été retiré le 2026-10-13 en attendant la Feature 9 : son retour dans la maquette se fait hors de ce sub-project, qui lit l'écran tel qu'il est au moment de l'implémentation
- **Design system** : `components/forms/Button`, `components/icons/Icon` (`external-link`, `spinner`), `components/overlay/Tooltip`, `components/feedback/ErrorMessage`
- Règle de lecture : `.claude/rules/design/claude-design.md`. Export local dans `.design-sync/design-system/`, à relire tel qu'il est au moment de l'implémentation
- **Arbitrages applicables** (DESIGN.md § Arbitrages) : « Récapitulatif » (décidé le 2026-10-12, réaligné le 2026-10-13) exclut encore « Envoyer ce rapport » du pied. Il est contredit par la décision du propriétaire du 2026-10-16, sa mise à jour se faisant hors de ce sub-project ; « Rouge des gestes sur les fichiers » (aucun `danger` ici, le geste ne touche aucun fichier musical) ; « Taille des contrôles » et « Position des tooltips » (bouton `size="small"`, tooltip sous l'élément par `WIDE_TOOLTIP`). Aucune largeur figée : libellé mesuré en FR et en EN

## Files touched

- **À créer** : `src/app/features/tagging/recap/feedback-send.ts` (`injectFeedbackSend()` : raison du grisé, attente, envoi, ouverture au retour)
- **À créer** : `src/app/features/tagging/recap/feedback-send.spec.ts`
- **À modifier** : `src/app/features/tagging/recap/recap-page.component.ts` (run affiché et présence de son rapport exposés à `injectFeedbackSend`, erreur de `prepare_feedback` du run affiché)
- **À modifier** : `src/app/features/tagging/recap/recap-page.component.html` (bouton dans le pied, erreur sous l'en-tête)
- **À modifier** : `src/app/features/tagging/recap/recap-page.component.spec.ts`
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`recap.feedback.send`, `recap.feedback.hint`, `recap.feedback.unavailable`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Monitoring : « Étape 8 : absent de l'interface au 2026-10-13 » ; ligne `opener` du tableau des plugins : l'ouverture de l'issue de retour et la révélation de son export)

## Architecture approach

- **Aucune règle métier dans l'interface** (`.claude/CLAUDE.md` § Standards, `.claude/rules/angular/components.md`) : l'interface ne choisit ni le contenu de l'issue ni celui de l'export. Elle envoie un `run_id`, reçoit une URL et un chemin, les ouvre
- **`injectFeedbackSend(run: Signal<FeedbackTarget | null>)`**, sur le patron d'`injectRunRestore()` (`features/tagging/run/run-restore.ts`) : appelée en initialiseur de champ du composant, elle rend `blockedReason`, `pending`, `send()` et pose l'effet d'ouverture. `FeedbackTarget` porte le `runId` du run affiché et `hasReport`, vrai quand son rapport existe :
  - run courant : son entrée figure dans `pastRuns` (registre des rapports, relu après chaque écriture), ce que `written()` du composant calcule déjà ;
  - run passé : il est chargé (`loaded()`), donc son rapport a été relu
- **Raison du grisé**, par priorité : moteur indisponible (`settings.admin.starting`, la phrase des actions d'administration des Réglages), puis aucun rapport pour ce run (`recap.feedback.unavailable`). Bouton jamais masqué, raison en tooltip (DESIGN.md § États des Composants)
- **Attente** : `pending` vaut `feedbackPending() === runId`. L'icône `external-link` laisse alors place au `spinner`, sans `[loading]` (déprécié en v22). `send()` ne fait rien quand le bouton est grisé ou en attente
- **Ouverture au retour** : `send()` retient le `run_id` demandé dans un signal local `requested`. Un `effect()` lit `feedbackReady()` et n'agit que si son `run_id` égale `requested`, qu'il efface aussitôt : revenir sur la page, ou ouvrir le récapitulatif d'un autre run, ne rejoue jamais un ancien `feedback_ready`. Il appelle `openUrl(url)` puis `revealItemInDir(export_path)` du plugin `opener`, en séquence : `await openUrl(url)`, puis `revealItemInDir`. L'Explorateur arrive au premier plan avec le fichier sélectionné, prêt à glisser dans le navigateur ouvert derrière. Chaque échec part en `console.error` comme l'ouverture de la fiche source (`track-detail.component.ts`) et le second appel part même si le premier échoue. L'effet lui-même n'attend rien : la séquence tourne en tâche détachée (`.claude/rules/angular/signals.md` : `effect()` réservé aux effets de bord)
- **Erreur** : `errorFor("prepare_feedback")`, retenue seulement si son `params.run_id` est celui du run affiché ou absent, rendue par `app-error-message` sous l'en-tête, à l'emplacement et à l'écart du refus de `load_run` (DESIGN.md § Feedback et chargement)
- **Bouton** (`.claude/rules/primeng/composants.md`) : `button pButton` `type="button"` `severity="secondary"` `[outlined]="true"` `size="small"`, icône 16px à gauche, `whitespace-nowrap`, sans largeur figée. Dans le pied, juste après « Retour à la liste », la ligne de contexte gardant son `ml-auto`. `[pTooltip]` sur le bouton lui-même, comme les actions d'administration des Réglages, lié à `[tooltipOptions]="WIDE_TOOLTIP"` (`shared/utils/tooltip.ts`) : texte `recap.feedback.hint` quand il est actif, raison du grisé sinon. La raison tient en une ligne, l'explication en demande deux : le jeu large sert aux deux pour qu'une seule liaison suffise
- **Traductions** (`.claude/rules/ngx-translate/i18n.md`) : `recap.feedback.send` à l'infinitif comme tout libellé d'action (« Envoyer ce rapport », « Send this report »), `recap.feedback.hint` dit ce qui va se passer, que le ticket est public et qu'il contient les noms de fichiers et les résultats du run, une phrase par ligne, `recap.feedback.unavailable` dit pourquoi le bouton est grisé. Vouvoiement, espaces insécables avant `:` en FR, mêmes clés dans les deux fichiers
- **DESIGN.md et maquette hors périmètre** (décision du propriétaire du 2026-10-16) : leur mise à jour se fait ailleurs. Si, au moment de l'implémentation, DESIGN.md ou le `Recap` de la maquette contredit ce que cette spec décide (style, emplacement, tooltip), l'écart est posé au propriétaire avant de coder, jamais tranché en silence (`.claude/rules/design/claude-design.md`)
- **Rules** : `.claude/rules/angular/components.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/tests.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/tailwindcss/echelles.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/typescript/types.md`, `.claude/rules/tauri/capabilities.md`, `.claude/rules/design/claude-design.md`

## Acceptance criteria

### Scénario 1 : envoi depuis le run courant
**GIVEN** le récapitulatif du run qui vient d'être écrit, son rapport dans les runs passés
**WHEN** l'utilisateur clique « Envoyer ce rapport »
**THEN** `prepare_feedback` part avec le `run_id` du run affiché et le bouton passe en spinner
**AND** au `feedback_ready` de ce run, le navigateur s'ouvre sur son `url`, puis l'Explorateur sur son `export_path`

### Scénario 2 : envoi depuis un run passé
**GIVEN** le récapitulatif d'un run passé, chargé
**WHEN** l'utilisateur clique « Envoyer ce rapport »
**THEN** `prepare_feedback` part avec le `run_id` de la route

### Scénario 3 : run sans rapport
**GIVEN** le récapitulatif du run courant, dont le rapport n'a pas pu être écrit
**WHEN** l'utilisateur survole le bouton
**THEN** le bouton est grisé et son tooltip dit qu'aucun rapport n'existe pour ce run

### Scénario 4 : moteur qui démarre
**GIVEN** le moteur de l'application pas encore prêt
**WHEN** l'utilisateur survole le bouton
**THEN** le bouton est grisé et son tooltip dit que le moteur démarre

### Scénario 5 : retour sur la page
**GIVEN** un `feedback_ready` déjà reçu pour un run
**WHEN** l'utilisateur rouvre le récapitulatif de ce run
**THEN** ni le navigateur ni l'Explorateur ne s'ouvrent

### Scénario 6 : refus
**GIVEN** un `prepare_feedback` refusé en `feedback_export_write_failed` pour le run affiché
**WHEN** l'erreur arrive
**THEN** sa phrase s'affiche sous l'en-tête et le bouton redevient actif
**AND** un refus portant le `run_id` d'un autre run ne s'affiche pas

## Tests à écrire

### Unit

- `src/app/features/tagging/recap/feedback-send.spec.ts` :
  - `send()` demande l'issue du run cible et retient la demande
  - au `feedback_ready` de la demande, `openUrl` puis `revealItemInDir` sont appelés, dans cet ordre (`vi.mock("@tauri-apps/plugin-opener")`)
  - un `feedback_ready` d'un autre run n'ouvre rien
  - un `feedback_ready` déjà présent à la création n'ouvre rien
  - `pending` suit `feedbackPending` du run cible et `send()` ne renvoie rien pendant l'attente
  - `blockedReason` vaut la raison du moteur, puis celle du rapport absent, puis `null` (le moteur prime quand les deux se cumulent)
  - moteur perdu pendant l'attente : `pending` retombe et `blockedReason` vaut la raison du moteur
- `src/app/features/tagging/recap/recap-page.component.spec.ts` :
  - le bouton est présent dans le pied du run courant et d'un run passé
  - au survol, grisé, il montre sa raison en tooltip (liaison `[pTooltip]`), actif il montre l'explication
  - l'erreur de `prepare_feedback` du run affiché s'affiche (`data-feedback-error`), celle d'un autre run non

`sidecarStub` (`src/fixtures/sidecar-stub.ts`) fournit `feedbackReady`, `feedbackPending` et `prepareFeedback` depuis `03-protocole-ndjson-retour` : les specs le surchargent, sans nouveau stub.

## Edge cases

- **Aucun navigateur par défaut** : `openUrl` échoue, l'échec part en `console.error`, l'Explorateur s'ouvre quand même sur l'export. Accepté, comme pour la fiche source
- **Explorateur refusé** : `revealItemInDir` échoue, l'issue reste ouverte, l'utilisateur peut l'envoyer sans fichier joint
- **Moteur perdu pendant l'attente** : `feedbackPending` retombe (03), le spinner aussi et le bouton se grise avec la raison du moteur. Aucune erreur `sidecar_unavailable` ne s'affiche : la perte du moteur ne pose pas d'erreur et `prepareFeedback` n'envoie rien sans moteur (03)
- **Clic, sortie, retour pendant l'attente** : `requested` vit dans l'instance de la page et se perd avec elle. Au retour, rien ne s'ouvre à l'arrivée de `feedback_ready` et le spinner retombe seul. Accepté : le geste est à refaire
- **Run passé en cours de chargement** : `hasReport` est faux quelques millisecondes, le bouton est grisé avec la raison `recap.feedback.unavailable`. Accepté
- **Refus sans `run_id`** (commande malformée visant `prepare_feedback`) : il s'affiche sur le récapitulatif courant plutôt que d'être filtré comme celui d'un autre run
- **Run courant restauré entre deux clics** : son rapport réécrit reste dans le registre, le bouton reste actif et l'issue décrit l'état restauré
- **Changement de langue** : le libellé et le tooltip suivent la langue, l'issue et l'export restent en anglais (ADR-014)

## Architectural decisions

### Décision : où vit la logique du bouton

**Options envisagées :**
- **A. Fonction `injectFeedbackSend()` à côté du composant** : même patron que `injectRunRestore()`, testable sans rendre la page, le composant ne fait que lier
- **B. Méthodes et effet dans `RecapPageComponent`** : un fichier de moins, mais un composant déjà dense qui grossit d'un effet et de trois dérivés, testés seulement à travers le rendu

**Choix : A**

**Rationale :**
- Le patron existe déjà pour un geste du récapitulatif, la restauration
- L'effet d'ouverture se teste sans DOM, là où se trouvent ses cas difficiles (demande retenue, ancien événement)

### Décision : ouvrir au retour de l'événement ou depuis le service

**Options envisagées :**
- **A. L'effet du geste ouvre, gardé par la demande retenue** : seul le clic de cette page ouvre quelque chose, `SidecarService` reste un miroir du protocole
- **B. `SidecarService` ouvre lui-même à chaque `feedback_ready`** : aucun état côté page, mais le service du protocole appellerait le plugin `opener` et ouvrirait sur un événement que personne n'attend plus

**Choix : A**

**Rationale :**
- Le service du protocole ne porte aucun effet de bord de plateforme
- La demande retenue rend impossible une ouverture sans clic, ce qu'exige le geste explicite d'ADR-014
