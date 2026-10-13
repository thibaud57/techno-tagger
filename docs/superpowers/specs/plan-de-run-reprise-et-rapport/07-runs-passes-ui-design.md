---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "runs-passes-ui"
goal: "Permettre de rouvrir en lecture seule, depuis les Réglages, le récapitulatif d'un run passé relu dans son rapport"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["04-protocole-ndjson-plan-rapport-design.md", "05-reprise-ui-design.md", "06-ecran-recapitulatif-ui-design.md"]
date: "2026-10-12"
---

# Runs passés

## Scope

Ce sub-project ajoute la liste des runs passés (`PastRunsStore`, routage de `runs_listed` et `run_loaded`, gestes `listRuns` et `loadRun`) et une rangée « Runs passés » dans les Réglages : un sélecteur des runs écrits et un bouton qui ouvre le récapitulatif. Il ajoute aussi la route `tagging/recap/:runId`, qui montre le récapitulatif d'un run passé en lecture seule, avec une ligne de contexte au pied de la table. Il exclut la restauration d'un run passé (celle du dernier run reste dans les Réglages, Feature 5), le rapport d'extraction et « Envoyer ce rapport » (Feature 9).

### État livré

À la fin de ce sub-project, on peut relancer l'application, ouvrir les Réglages, choisir un run passé et l'ouvrir. Son récapitulatif s'affiche dans l'onglet Tagging, filtrable, avec l'avant / après et le lien vers la fiche source de chaque morceau, sans rien rejouer et sans geste de restauration.

## Dependencies

- `04-protocole-ndjson-plan-rapport-design.md` (statut: draft) : `ListRunsCommand`, `LoadRunCommand`, `RunsListedEvent`, `RunLoadedEvent`, `PastRun` et `TrackLoaded` dans `protocol.ts`, avec un `tags_before` de même forme que dans `run_started`.
- `05-reprise-ui-design.md` (statut: draft) : `runDate` dans `shared/utils/run-date.ts` et le cas sans effet de `handleLine` dont `interrupted_run` est déjà sorti.
- `06-ecran-recapitulatif-ui-design.md` (statut: draft) : `RecapPageComponent`, `recap-filter.ts`, `RunListComponent.emptyState`, `injectRunRestore()`, `src/fixtures/virtual-scroll.ts`, la route `tagging/recap` et `sourceUrl`.

## Références de design

- **Maquette** : aucun écran ne montre la liste des runs passés. `SettingsScreen` (rangée « Restauration », `LAST_RUN`) donne le patron de rangée et la formulation « Run du … sur … ». `TaggingScreen`, avec `Recap`, donne le récapitulatif rouvert.
- **Design system** : fiches `forms/SettingsRow`, `forms/Select`, `forms/Button`, `feedback/EmptyState`, `data/DataTable`.
- Règle de lecture : `.claude/rules/design/claude-design.md`.

## Files touched

- **À créer** : `src/app/core/past-runs.store.ts`, `past-runs.store.spec.ts`
- **À modifier** : `src/app/core/sidecar.service.ts`, `sidecar.service.spec.ts` (`listRuns`, `loadRun`, routage, `routeLoadRunError`, appel après une écriture)
- **À modifier** : `src/app/features/settings/settings-page.component.ts`, `.html`, `.spec.ts` (rangée « Runs passés »)
- **À modifier** : `src/app/features/tagging/recap-page.component.ts`, `.html`, `.spec.ts` (`runId`, chargement, contexte, lecture seule, refus)
- **À modifier** : `src/app/app.routes.ts` (`tagging/recap/:runId`)
- **À créer** : `src/fixtures/past-runs.ts` (`PAST_RUN`, `TRACK_LOADED`, `runsListed`, `runLoaded`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`settings.admin.pastRuns.*`, `recap.past.*`)
- **À modifier** : `docs/DESIGN.md` (mapping, arbitrage)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Navigation : route du run passé)
- **À modifier** : `.design-sync/NOTES.md` (§ Reste ouvert)

## Architecture approach

### Store

`PastRunsStore` est un `@Service()` à signals, ré-exposé par `SidecarService` et jamais injecté dans un composant (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`). Il porte :
- `runs` : la liste de `runs_listed`, `null` tant qu'elle n'est pas arrivée ;
- `loaded` : le run rouvert (`runId`, `folder`, `writtenAt`, `tracks`) ;
- `loading` : le `runId` en cours de chargement.

`writtenAt` reprend `generated_at` de `run_loaded` : le sidecar pose le même instant dans le rapport et dans le registre (`written_at`, sub-project 03) et l'interface ne connaît qu'une date.

La conversion de `TrackLoaded` en `TaggingTrack` est une fonction pure du store :
- `fileName` vaut le nom d'origine ;
- `arbitration` est nul ;
- `restorable` est faux : le récapitulatif est en lecture seule et `run_loaded` ne dit rien de la restauration.

Le reste est recopié champ par champ, sans rien recalculer : le sidecar est seul juge des états.

### Service

- **`listRuns()`** envoie `list_runs`. Il est appelé par les Réglages quand le moteur devient disponible (l'`effect` qui lit déjà la cible de restauration) et par le service après chaque `run_finished` en phase `write`, comme `loadRollbackTarget` : un nouveau rapport vient d'être écrit. Il n'envoie rien tant que le moteur n'est pas disponible : une lecture seule ne doit pas passer par `reportUnavailable`, qui arrêterait le run affiché.
- **`loadRun(runId)`** suit la même garde et ne renvoie pas la commande d'un run déjà en chargement. Il pose `loading`, vide `loaded` s'il désigne un autre run et le refus précédent, puis envoie `load_run`.
- **Routage** : `runs_listed` et `run_loaded` sont routés vers le store, à la place des cas sans effet du sub-project 04.
- **Refus de `load_run`** (`run_not_found`, `tagging_report_unreadable`, ou `phase_busy` quand une phase longue tourne) : `routeLoadRunError`, sur le patron de `routeArbitrationError`, confie l'événement au store. Le store garde le refus avec son `runId` (le `run_id` des paramètres, sinon le run en chargement : un `phase_busy` n'en porte pas) et ne vide `loading` que si le refus vise le run attendu. Le service l'expose en lecture seule (`loadRefusal`) : `lastError` ne convient pas, toute autre commande l'efface. Un `run_loaded` qui ne désigne pas le run attendu est ignoré : `load_run` n'occupe aucune phase, deux chargements peuvent courir et la réponse d'un run que personne n'attend ne remplace rien. Le refus est vidé par la demande suivante d'un run ; la page ne montre que celui de son run.

### Rangée des Réglages

La rangée « Runs passés » se place sous « Restauration », au patron `SettingsRow` (arbitrage « Rangée de Réglages » : le libellé à gauche, le contrôle et son aide à droite).
- **Sélecteur** : un `p-select` `size="small"` lié par Signal Forms (`[formField]`, comme la page Playlist, `.claude/rules/angular/forms.md`). Chaque option est « Run du {date} sur {dossier} », par la clé `settings.admin.rollback.target` que la rangée « Restauration » emploie déjà : une seule clé pour nommer un run. La date est `written_at` passée par `runDate` (sub-project 05). L'ordre est celui du registre, le plus récent d'abord : l'interface ne trie pas.
- **Largeur** : aucune largeur figée. Le sélecteur prend le reste de la ligne et coupe le dossier, dont le tooltip montre le texte entier (`TruncatedTextComponent` dans `#selectedItem`). Le libellé de la rangée nomme le sélecteur pour un lecteur d'écran (`id` du libellé repris par `ariaLabelledBy`).
- **Choix** : le run le plus récent par défaut. Le choix survit à une nouvelle liste ou à un changement de langue tant que son run y figure, sinon il retombe sur le plus récent.
- **Bouton** : « Ouvrir le récapitulatif » (`secondary` outlined, `size="small"`) navigue vers `/tagging/recap/:runId` et l'onglet Tagging devient actif.
- **Sans run** : le sélecteur est désactivé par une règle du formulaire, avec le placeholder « Aucun run à rouvrir » et le bouton est désactivé.

Un sélecteur plutôt qu'une table, car la page des Réglages ne défile pas (DESIGN § Layout) et la liste n'a pas de borne.

### Récap d'un run passé

La route `tagging/recap/:runId` charge le même `RecapPageComponent`. Son entrée `runId` est liée par `withComponentInputBinding`, déjà passé à `provideRouter` dans `app.config.ts` (`.claude/rules/angular/routing.md`).

- **Chargement** : avec un `runId`, un `effect` (side-effect d'envoi, `.claude/rules/angular/signals.md`) envoie `load_run` dès que le moteur est disponible, une fois par instance de la page et par `runId`. Deux ouvertures du même run envoient donc deux commandes et les pochettes sont retéléchargées à chaque ouverture. La table affiche ses lignes squelettes tant que le run n'est ni chargé ni refusé.
- **Données** : les morceaux viennent de `loaded` quand il désigne le `runId` de la route, sinon du run affiché. Filtres, recherche, détail et lien source sont ceux du sub-project 06.
- **En-tête** : le titre est suivi d'une ligne `text-sm text-muted-color`, « Run du {date} sur {dossier} », par la même clé `settings.admin.rollback.target` et la même date que les Réglages.
- **Lecture seule** : ni « Restaurer le run », ni « Restaurer ce morceau » (`restorableIds` vide), ni « Nouveau run ». Le message d'échec d'écriture et le bilan de restauration appartiennent au run vivant : ils n'apparaissent pas sur un run passé.
- **Refus** : le message d'erreur traduit (`app-error-message`) et un `EmptyState` encadré remplacent la table, seulement quand le refus porté par le store vise le `runId` de la route : le refus d'un autre run ne s'affiche pas.

### Textes

`settings.admin.pastRuns.*` (libellé, aide, placeholder, Ouvrir) et `recap.past.*` (état d'un run qui ne se rouvre pas), en FR et EN dans le même commit (`.claude/rules/ngx-translate/i18n.md`).

### Conventions

Aucun `changeDetection` déclaré (`.claude/rules/angular/change-detection.md`). Tokens seulement (`.claude/rules/tailwindcss/utilitaires.md`). PrimeNG d'abord (`.claude/rules/primeng/composants.md`). Unions fermées par `never` (`.claude/rules/typescript/types.md`).

## Acceptance criteria

### Scénario 1 : liste des runs passés
**GIVEN** deux runs écrits, le 2 août et le 5 août
**WHEN** l'utilisateur ouvre les Réglages
**THEN** le sélecteur « Runs passés » propose « Run du 5 août … » puis « Run du 2 août … », avec leur dossier

### Scénario 2 : ouvrir un run passé
**GIVEN** le run du 2 août choisi
**WHEN** l'utilisateur clique « Ouvrir le récapitulatif »
**THEN** l'onglet Tagging affiche le récapitulatif de ce run, avec « Run du 2 août sur … » sous le titre, ses filtres, ses compteurs et le lien vers la fiche source de chaque morceau

### Scénario 3 : lecture seule
**GIVEN** le récapitulatif d'un run passé dont le dump existe encore
**WHEN** il s'affiche
**THEN** aucun bouton de restauration ni « Nouveau run » n'est proposé
**AND** le message d'échec d'écriture et le bilan de restauration du run vivant n'y figurent pas

### Scénario 4 : rapport disparu
**GIVEN** un run dont le rapport a été supprimé après la liste
**WHEN** l'utilisateur l'ouvre
**THEN** le récapitulatif affiche le message de `run_not_found` à la place de la table

### Scénario 5 : aucun run passé
**GIVEN** un registre vide
**WHEN** l'utilisateur ouvre les Réglages
**THEN** le sélecteur est désactivé sur « Aucun run à rouvrir » et le bouton aussi

## Tests à écrire

### Unit
- `src/app/core/past-runs.store.spec.ts` :
  - un `TrackLoaded` devient un `TaggingTrack` aux mêmes noms, états, tags avant et après et `sourceUrl`, avec `restorable` faux
  - le run chargé est gardé et le chargement levé, oublié quand un autre run est demandé
  - la réponse d'un run que personne n'attend ne remplace ni ne lève le chargement du run attendu, qu'elle arrive avant ou après la sienne
  - un refus est gardé avec son run, attribué au run en chargement sans `run_id`, vidé par la demande suivante, et ne lève pas le chargement d'un autre run
- `src/app/core/sidecar.service.spec.ts` :
  - `list_runs` part après une écriture terminée
  - `runs_listed` et `run_loaded` alimentent `pastRuns` et `loadedRun`
  - un run en chargement n'est pas redemandé
  - un refus de `load_run`, y compris en `phase_busy`, vide le chargement et se lit par `loadRefusal`, qu'une autre commande envoyée ensuite n'efface pas
  - sans moteur, ni `list_runs` ni `load_run` ne partent et le run affiché reste
- `src/app/features/settings/settings-page.component.spec.ts` :
  - `list_runs` part quand le moteur devient disponible
  - chaque option nomme son run par sa date et son dossier, dans l'ordre du sidecar (scénario 1)
  - le choix survit à une nouvelle liste tant que son run y figure
  - le sélecteur est nommé par le libellé de la rangée
  - « Ouvrir le récapitulatif » navigue vers `/tagging/recap/<runId>` (scénario 2)
  - sans run, sélecteur et bouton désactivés (scénario 5)
- `src/app/features/tagging/recap-page.component.spec.ts` :
  - avec un `runId`, `load_run` part une fois par page, une fois le moteur disponible
  - les squelettes s'affichent jusqu'au chargement, puis les morceaux et la ligne de contexte au pied de la table (scénario 2)
  - aucun bouton de restauration ni « Nouveau run » même quand le run vivant est restaurable (scénario 3)
  - ni message d'échec d'écriture ni bilan de restauration sur un run passé (scénario 3)
  - un refus de `load_run` remplace la table par le message (scénario 4)
  - le refus d'un autre run laisse les squelettes
  - sans `runId`, le run affiché revient malgré un run chargé

## Edge cases

- **Deep-link sur un `runId` inconnu** : `run_not_found`, comme au scénario 4.
- **Nouveau run écrit, Réglages ouverts** : la liste se met à jour à la fin de l'écriture.
- **Run rouvert puis retour à `/tagging/recap`** (sans `runId`) : le récap du run affiché revient et `loaded` ne le masque pas.
- **Phase longue en cours** : `load_run` est refusé en `phase_busy`. Le récapitulatif affiche la phrase de la phase qui tourne à la place de la table.
- **Pochette indisponible** : la vignette reste vide, comme pour un run vivant (sub-project 04).
- **Liste rafraîchie pendant le choix** : le run choisi reste sélectionné s'il est toujours listé.

## Architectural decisions

### Décision : entrée vers les runs passés
**Options envisagées :**
- **A. Rangée des Réglages**, à côté de « Restauration », qui nomme déjà le dernier run.
- **B. Section de l'onglet Tagging au repos**, sous le choix du dossier.
- **C. Bouton et modale** depuis l'onglet Tagging.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Les Réglages portent déjà ce qui concerne les runs écrits.

### Décision : restauration depuis un run passé
**Options envisagées :**
- **A. Lecture seule** : aucun geste de restauration.
- **B. Restauration possible** sur les morceaux encore au dump.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Les fichiers ont pu être retagués depuis et la restauration du dernier run reste dans les Réglages.

### Décision : forme de la liste
**Options envisagées :**
- **A. Sélecteur et bouton**, au patron d'une rangée des Réglages.
- **B. Table des runs** : lisible, mais la page des Réglages ne défile pas et la liste n'a pas de borne.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Une rangée garde la page sur une hauteur fixe, quel que soit le nombre de runs.
