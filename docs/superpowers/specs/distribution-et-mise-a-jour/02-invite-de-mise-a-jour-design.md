---
feature: "Feature 8 : Distribution et mise à jour"
subproject: "invite-de-mise-a-jour"
goal: "Vérifier au lancement de l'application si une version plus récente est publiée, la proposer dans une modale, puis la télécharger et l'installer sur accord de l'utilisateur"
status: "implemented"
complexity: "L"
tdd_scope: "partial"
depends_on: ["01-chaine-de-signature-design.md"]
date: "2026-10-15"
---

# Invite de mise à jour

## Scope

Couvre :
- un service qui interroge l'updater une fois au démarrage, derrière un `InjectionToken` ;
- la modale « Mise à jour disponible » : version proposée et version installée, « Voir les nouveautés », « Plus tard », « Installer », progression du téléchargement, échec et « Réessayer » ;
- le badge de la barre d'onglets qui prend le relais après fermeture ;
- le report de l'installation tant qu'un travail tourne ;
- la priorité donnée à l'invite de reprise ;
- un événement Sentry sur un téléchargement ou une installation en échec ;
- l'icône `download` et les libellés FR/EN.

Exclut :
- la rangée des Réglages et la recherche manuelle (sub-project 03) ;
- toute vérification périodique ou en cours de session ;
- les notes de version affichées dans la modale ;
- la relance par le plugin `process`.

### État livré

À la fin de ce sub-project, les specs Vitest du service, de la modale et du shell montrent, avec l'updater remplacé par un faux :
- la modale qui s'ouvre au lancement sur une version disponible ;
- sa fermeture puis sa réouverture par le badge ;
- l'installation qui suit la barre de progression ;
- un échec suivi d'une nouvelle tentative.

Sous `ng serve`, sans Tauri, ni modale ni badge ne s'affichent. La chaîne réelle se joue au sub-project 04.

## Dependencies

- `01-chaine-de-signature-design.md` (statut: draft) : plugin updater enregistré, `plugins.updater` configuré et permission `updater:default` déclarée, sans lesquels `check()` échoue en ACL.

Hors feature :
- `formatBytes` de `src/app/shared/utils/bytes.ts`, livré par la Feature 7 (sub-project `administration-cache-et-logs`), formate le compteur du téléchargement.

## Références de design

- **Maquette** : aucun écran de mise à jour. Modèles repris de `AppShell` :
  - l'invite de reprise (gabarit, pied, ton) ;
  - `CloseConfirmation` (modale fermable) ;
  - le groupe de badges de l'`aside` des `Tabs`.
- **Design system** : `components/overlay/Dialog.prompt.md`, `components/forms/Button.prompt.md`, `components/data/PhaseProgress.prompt.md`, `components/feedback/Message.prompt.md`, `components/feedback/Tag.prompt.md`, `components/overlay/Tooltip.prompt.md`
- Règle de lecture : `.claude/rules/design/claude-design.md`

Décisions du propriétaire (2026-10-15), l'écran étant absent de la maquette :
- **Gabarit** : celui de l'invite de reprise, mais fermable par la croix.
- **Fermeture** : la croix et « Plus tard » renvoient au badge « Mise à jour X.Y.Z » (icône `download`), rangé dans le groupe des badges.
- **Nouveautés** : un lien `link` « Voir les nouveautés » vers la Release, sans liste dans la modale.
- **Installation** : « Installer » remplace le corps par la progression, la modale devenant non fermable.
- **Échec** : un `app-message` error, avec « Réessayer ».

La ligne d'arbitrage correspondante rejoint `docs/DESIGN.md`.

## Files touched

- **À créer** : `src/app/core/platform/updater.ts` (token `APP_UPDATER` et son implémentation Tauri) et `updater.spec.ts`
- **À créer** : `src/app/core/platform/update.service.ts` et `update.service.spec.ts`
- **À créer** : `src/app/shared/components/dialogs/update-dialog.component.ts` et `update-dialog.component.spec.ts`
- **À créer** : `src/fixtures/updater.ts` (faux updater partagé par les specs)
- **À modifier** : `src/app/app.config.ts` (initialiseur qui lance la vérification sans attendre)
- **À modifier** : `src/app/app.component.ts`, `src/app/app.component.html`, `src/app/app.component.spec.ts` (badge, modale différée)
- **À modifier** : `src/app/shared/components/display/icon.component.ts` (icône `download`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (bloc `update`)
- **À modifier** : `docs/DESIGN.md` (ligne du mapping des badges, ligne d'arbitrage)
- **À modifier** : `docs/ARCHITECTURE.md` (rôle de `core/platform/` l.409)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert : modale et badge absents de la maquette)

## Architecture approach

- **Plugin enveloppé derrière `APP_UPDATER`**, sur le modèle d'`APP_WINDOW` et `SIDECAR_TRANSPORT` :
  - L'interface rend `null` ou une mise à jour réduite à ce que l'application emploie : `version`, `currentVersion`, la page de la Release, un `downloadAndInstall` qui remonte octets reçus et total connu ou non.
  - L'implémentation Tauri lève hors Tauri (`ng serve`), ce que le service traite comme un échec de vérification.
  - Les specs remplacent le token par le faux de `src/fixtures/updater.ts`, jamais par `vi.mock` du plugin (`.claude/rules/angular/tests.md`).
- **Page de la Release dérivée du manifeste** : l'`url` de la plateforme Windows (`…/releases/download/<tag>/<installeur>`) donne `…/releases/tag/<tag>`. Aucune adresse du dépôt n'est recopiée en TypeScript. Faute de forme reconnue, pas de lien.
- **`UpdateService`** (`@Service()`, signaux, `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`) :
  - Il porte un état unique : aucune, disponible, téléchargement avec progression, échec.
  - Il expose aussi une fermeture par l'utilisateur, un indicateur « installable » faux tant que `SidecarService.phase()` n'est pas `idle` et la visibilité de la modale et du badge.
  - La vérification part d'un `provideAppInitializer` sans attendre, comme `SidecarService.start()`.
- **Priorité à l'invite de reprise** : la modale ne s'ouvre d'elle-même que si l'invite de reprise n'est pas affichée et qu'aucun travail ne tourne. Sinon, ou si l'invite apparaît avant tout geste sur la mise à jour, la mise à jour passe directement au badge et y reste.
- **Échecs** :
  - Une vérification en échec (hors ligne, `latest.json` en 404 pendant un build, hors Tauri) ne laisse ni état ni événement.
  - Un téléchargement ou une installation en échec passe l'état en échec et envoie `Sentry.captureException` : c'est le seul signal d'une chaîne de signature cassée chez un utilisateur (PRODUCTION.md § Incident Response). Le SDK durci retire les chemins (ADR-014, `.claude/rules/sentry/angular.md`).
  - « Réessayer » refait une vérification puis relance le téléchargement.
- **Installation sous Windows** : l'application se ferme d'elle-même à l'installation et l'installeur la relance par défaut (`restartAfterInstall`, plugin 2.11, laissé à son défaut), d'où l'absence du plugin `process`. Rien n'est attendu après l'appel d'installation (`.claude/rules/tauri/config-bundle.md`).
- **Modale `UpdateDialogComponent`** (`shared/components/dialogs/`) :
  - `p-dialog` modal `w-120` comme l'invite de reprise, fermable (`closable`, `closeOnEscape`), sauf pendant le téléchargement.
  - Le corps est en `text-sm whitespace-pre-line text-muted-color`.
  - Le lien est un `pButton` `link` qui ouvre la page par `openUrl` du plugin `opener` (permission déjà accordée).
  - La progression passe par `PhaseProgressComponent`, indéterminée tant que le total est inconnu, avec un compteur par `formatBytes`. L'échec passe par `MessageComponent` error.
  - Boutons `size="small"`, « Plus tard » texte `secondary`, « Installer » `primary`, désactivé avec tooltip sous l'élément pendant un travail.
  - Rules : `.claude/rules/angular/components.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/utilitaires.md`.
- **Shell** :
  - La modale est montée en `@defer (when …; prefetch on idle(5s))` dans la branche non bloquée (`.claude/rules/angular/lazy-loading.md`).
  - Le badge est un bouton portant un `p-tag` `info`, icône `download`, ajouté au groupe `gap-2` des badges. Il rouvre la modale et reste visible jusqu'au lancement suivant.
- **Icône `download`** : import `@primeicons/angular/download`, nom dans `ICON_NAMES`, `imports`, `@case`. Le test de liste existant la couvre.
- **Libellés** : bloc `update` dans les deux fichiers, une phrase par ligne, espace insécable avant `:` et `?`, vouvoiement, « l'application » et jamais « l'app » (`.claude/rules/ngx-translate/i18n.md`).
- Rules applicables : `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/components.md`, `.claude/rules/angular/routing.md`, `.claude/rules/angular/lazy-loading.md`, `.claude/rules/angular/app-config.md`, `.claude/rules/angular/tests.md`, `.claude/rules/primeng/composants.md`, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/ngx-translate/i18n.md`, `.claude/rules/sentry/angular.md`, `.claude/rules/typescript/types.md`, `.claude/rules/tauri/config-bundle.md`, `.claude/rules/design/claude-design.md`. ADRs : ADR-001, ADR-014, ADR-018 (le plan de run survit à la mise à jour).

## Acceptance criteria

### Scénario 1 : mise à jour proposée au lancement
**GIVEN** une version plus récente publiée et aucune invite de reprise
**WHEN** l'application démarre
**THEN** la modale « Mise à jour disponible » s'ouvre avec la version proposée et la version installée
**AND** « Voir les nouveautés » ouvre la page de la Release de cette version

### Scénario 2 : rien à proposer
**GIVEN** aucune version plus récente, ou une vérification en échec (hors ligne, manifeste en 404, hors Tauri)
**WHEN** l'application démarre
**THEN** ni modale ni badge ne s'affichent
**AND** aucun événement Sentry n'est envoyé

### Scénario 3 : report au badge
**GIVEN** la modale ouverte
**WHEN** l'utilisateur clique « Plus tard » ou la croix
**THEN** la modale se ferme et le badge « Mise à jour X.Y.Z » apparaît dans le groupe des badges
**AND** un clic sur le badge rouvre la modale

### Scénario 4 : invite de reprise prioritaire
**GIVEN** un run interrompu dont l'invite de reprise s'affiche au lancement
**WHEN** la vérification trouve une version plus récente
**THEN** la modale de mise à jour ne s'ouvre pas et le badge apparaît

### Scénario 5 : installation pendant un travail
**GIVEN** la modale rouverte par le badge pendant une recherche, une extraction, une écriture ou une restauration
**WHEN** l'utilisateur survole « Installer »
**THEN** le bouton est désactivé et le tooltip dit que l'installation sera disponible à la fin du travail en cours

### Scénario 6 : téléchargement et installation
**GIVEN** la modale ouverte, aucun travail en cours
**WHEN** l'utilisateur clique « Installer »
**THEN** le corps fait place à la barre de progression avec son compteur, la croix et les boutons disparaissent
**AND** l'installation part à la fin du téléchargement

### Scénario 7 : échec et nouvelle tentative
**GIVEN** un téléchargement ou une installation qui échoue
**WHEN** l'erreur remonte
**THEN** la modale affiche le message d'échec avec « Plus tard » et « Réessayer » et un événement Sentry part
**AND** « Réessayer » refait la vérification et relance le téléchargement

## Tests à écrire

### Unit
- `src/app/core/platform/updater.spec.ts` :
  - dérive la page de la Release de l'`url` de l'installeur
  - ne dérive aucune page d'une autre adresse, d'une `url` qui n'est pas une chaîne ou d'un manifeste sans entrée Windows
  - cumule les octets reçus, total inconnu compris
- `src/app/core/platform/update.service.spec.ts` :
  - n'expose aucune mise à jour quand rien n'est publié
  - reste silencieux, sans Sentry, quand la vérification échoue
  - propose la mise à jour trouvée avec ses deux versions
  - passe directement au badge quand l'invite de reprise est affichée
  - passe directement au badge une mise à jour trouvée pendant un travail
  - passe au badge et y reste quand l'invite de reprise apparaît avant tout geste
  - rouvre la modale depuis le badge
  - n'est pas installable tant qu'une phase du sidecar n'est pas `idle`
  - suit la progression reçue, total inconnu compris
  - signale à Sentry un téléchargement en échec et passe en échec
  - refait une vérification puis relance le téléchargement sur « Réessayer »
  - retire l'offre quand la nouvelle vérification ne trouve plus rien
- `src/app/shared/components/dialogs/update-dialog.component.spec.ts` :
  - affiche les deux versions, « Plus tard » et « Installer »
  - renvoie au badge par « Plus tard » et par la croix
  - désactive « Installer » pendant un travail
  - remplace le corps par la progression, sans croix ni bouton, pendant le téléchargement
  - affiche le message d'échec et « Réessayer » après un échec
  - ouvre la page de la Release par « Voir les nouveautés » et masque le lien sans page
- `src/app/app.component.spec.ts` :
  - affiche le badge de mise à jour après report et rouvre la modale au clic
  - n'affiche aucun badge de mise à jour sans mise à jour

## Edge cases

- **Hors Tauri (`ng serve`)** : l'appel au plugin lève, traité comme une vérification en échec, donc silencieux.
- **`tauri dev`** : la version installée est celle du dépôt, aucune version plus récente n'est proposée tant que le dépôt suit la dernière Release.
- **Écran bloquant** (sidecar absent, versions désaccordées) : ni modale ni badge, la branche du shell qui les porte n'étant pas rendue. L'écran de versions désaccordées conseille déjà de réinstaller.
- **Clic répété sur « Installer »** : le premier clic fait passer la modale en téléchargement, qui n'a plus de bouton.
- **Fermeture par l'installeur** : la sortie forcée sous Windows ne passe pas par la demande de fermeture que garde `CloseGuard`, sans conséquence puisqu'aucun travail ne tourne. À observer au smoke test du sub-project 04.
- **Run interrompu et mise à jour** : le plan de run survit à la mise à jour (ADR-018), l'invite de reprise revient au lancement suivant.

## Architectural decisions

### Décision : accès au plugin updater

**Options envisagées :**
- **A. Appel direct de `check()` dans le service, `vi.mock` du plugin dans les specs** : comme `opener` aujourd'hui, mais les specs se couplent à la forme de l'objet `Update` du plugin.
- **B. Token `APP_UPDATER` à l'interface réduite, faux partagé dans `src/fixtures/`** : un fichier de plus et les specs ne connaissent que notre contrat.

**Choix : B**

**Rationale :**
- Modèle déjà en place pour la fenêtre et le transport du sidecar.
- `.claude/rules/angular/tests.md` : mocker au niveau du service qui expose le plugin, pas le plugin.
- La dérivation de la page de la Release et le cumul des octets restent testables sans plugin.

### Décision : relance après installation

**Options envisagées :**
- **A. Relance par l'installeur NSIS**, comportement par défaut de l'updater sous Windows : aucune dépendance.
- **B. `relaunch()` du plugin `process`** : une crate, un paquet npm et une permission de plus, pour un appel qui ne s'exécute pas sous Windows, l'application étant déjà sortie.

**Choix : A**

**Rationale :**
- L'updater 2.11 a ajouté `restartAfterInstall` pour empêcher la relance par l'installeur : la relance est donc le défaut.
- Le code placé après l'installation n'est pas garanti sous Windows.
- Si le smoke test du sub-project 04 montrait l'inverse, B s'ajoute sans toucher au reste.
