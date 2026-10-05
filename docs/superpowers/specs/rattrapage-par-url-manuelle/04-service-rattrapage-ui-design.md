---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "service-rattrapage-ui"
goal: "Tenir côté Angular l'état de la phase de rattrapage par URL et relayer les gestes de l'utilisateur vers le sidecar"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["03-protocole-ndjson-rattrapage-design.md"]
date: "2026-10-03"
---

# Service Angular du rattrapage par URL

## Scope

Couvre `UrlRecoveryStore` (progression de la phase, gestes en vol et dernière erreur par morceau), le geste `resolveByUrl` et la lecture déléguée dans `SidecarService`, le routage de `progress(url_recovery)`, de `track_resolved` et des erreurs de `resolve_by_url`, la liste des morceaux à afficher dans la phase et le cycle de vie de son état.

Exclut tout composant et tout libellé (sub-project 05), la garde de fermeture (décision ci-dessous) et la confirmation d'écriture (Feature 5).

### État livré

À la fin de ce sub-project, on peut : lancer `just test-ui` et voir passer des tests Vitest qui, sur un transport simulé, montrent que la phase s'ouvre à la première progression reçue, qu'un `resolveByUrl` envoie sa commande une seule fois tant que le morceau attend, que la réponse lève l'attente ou attache l'erreur à son morceau, et que la phase se vide au run suivant comme à la mort du process.

## Dependencies

- `03-protocole-ndjson-rattrapage-design.md` (statut: draft) : commande `resolve_by_url`, `progress` de phase `url_recovery` à l'ouverture et après chaque geste, erreurs portant `command` et `params.track_id`, miroir `ResolveByUrlCommand` dans `protocol.ts`.

## Files touched

- **À créer** : `src/app/core/url-recovery.store.ts` (`UrlRecoveryStore`)
- **À créer** : `src/app/core/url-recovery.store.spec.ts`
- **À modifier** : `src/app/core/sidecar.service.ts` (injection du store, `resolveByUrl`, lecture déléguée, `recoverableTracks`, routage, cycle de vie)
- **À modifier** : `src/app/core/sidecar.service.spec.ts`
- **À créer** : `src/fixtures/url-recovery.ts` (`urlProgress`, `resolvedByUrl`, `urlRecoveryError`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Frontend, State Management)

## Architecture approach

- **Un store par phase**, jamais injecté dans un composant (`.claude/rules/angular/services.md`, ARCHITECTURE.md § State Management) : `UrlRecoveryStore` rejoint `TaggingRunStore` et `ArbitrationStore`, `SidecarService` reste la seule frontière que lisent les composants. Le commentaire de `TaggingRunStore` l'annonçait : « les Features 3 à 6 ajouteront leur propre store ».
- **État de `UrlRecoveryStore`**, `WritableSignal` privés exposés en lecture seule (`.claude/rules/angular/signals.md`), collections remplacées et jamais mutées en place :
  - la progression `{ processed, total }`, `null` tant que la phase n'est pas ouverte ;
  - l'ensemble des `track_id` dont un geste attend sa réponse ;
  - la dernière erreur par `track_id`, l'événement `error` entier : l'écran traduit son `code` avec ses `params` (`{{source}}` de `source_unavailable` et `track_not_found`).
- **Lecture** : `progress`, `open` (vrai dès la première progression reçue), `busy` (ensemble des morceaux en attente), `errors` (dernière erreur par morceau), et `isBusy(trackId)` pour la garde du geste. L'écran lit les deux collections dans un `computed()`, jamais par un appel de méthode dans le template (`.claude/rules/angular/change-detection.md`).
- **Mutations** : `advanced(processed, total)` ; `sent(trackId)` pose l'attente et efface l'erreur précédente du morceau ; `resolved(trackId)` lève l'attente et l'erreur ; `rejected(trackId, error)` lève l'attente et garde l'erreur ; `clear()` vide tout.
- **Ouverture lue, pas déduite** : la phase est ouverte quand le sidecar a émis sa première progression `url_recovery` (sub-project 03 : après `run_finished(network)` ou un `cancel_run` qui a interrompu la phase réseau). L'interface ne recalcule ni l'ouverture ni le décompte.
- **`SidecarService`** :
  - **geste** `resolveByUrl(trackId, url)` : ignoré si le morceau attend déjà une réponse, ou si l'URL est vide, sans quoi le sidecar rendrait un `malformed_command` sans `track_id` et l'attente ne se lèverait jamais. Sinon pose l'attente et envoie la commande ;
  - **lecture déléguée** : `urlRecoveryOpen`, `urlRecoveryProgress`, `urlRecoveryBusy`, `urlRecoveryErrors` ;
  - **`recoverableTracks`** : les lignes de `TaggingRunStore.tracks` en `unresolved` ou en `resolved · url`, dans l'ordre du run. Filtre d'affichage sur des états reçus, comme les familles « en attente » et « à arbitrer » que l'interface dérive déjà (DESIGN.md § Palette de Couleurs > Couleurs Sémantiques) : le sidecar reste seul juge de l'éligibilité et refuse tout autre morceau en `url_recovery_not_eligible` ;
  - **routage** : `progress` de phase `url_recovery` vers `advanced`, le cas groupé de `routeProgress` étant séparé de `write` (Feature 5) ; `track_resolved` aussi vers `urlRecovery.resolved`, à côté du run et de l'arbitrage ; une `error` dont `command` vaut `resolve_by_url` et dont `params.track_id` est une chaîne vers `rejected`, en restant dans `lastError` pour `errorFor(...)` ;
  - **cycle de vie** : la phase se vide à `startTagging`, avec `reset()` du run et `clear()` de l'arbitrage, et à la mort du process (`endRun`). Elle ne se vide pas à `cancelTagging` : l'interruption ouvre au contraire la phase, sa progression arrive juste après.
- **Erreur sans `track_id`** (`sidecar_unavailable` posé par `send`) : non routée vers le store, `endRun` vide déjà tout.
- **Fixtures** : `src/fixtures/url-recovery.ts`, fabriques paramétrées sur le patron d'`arbitrationRequired` (`src/fixtures/tagging.ts`).
- **Docs** : ARCHITECTURE.md se modifie avec le skill `architecture-doc`.
- **Qualité** : ESLint, `tsc` strict (`.claude/rules/typescript/types.md`), tests Vitest selon `.claude/rules/angular/tests.md`.

## Acceptance criteria

### Scénario 1 : Ouverture de la phase
**GIVEN** un run commencé, phase réseau en cours
**WHEN** le sidecar émet `progress` de phase `url_recovery`, `processed` 0, `total` 2
**THEN** `urlRecoveryOpen` passe à vrai et `urlRecoveryProgress` vaut 0 sur 2
**AND** la progression du run de tagging est inchangée

### Scénario 2 : Geste envoyé une seule fois
**GIVEN** la phase ouverte et un morceau `unresolved`
**WHEN** l'utilisateur rattrape ce morceau deux fois de suite avant toute réponse
**THEN** une seule commande `resolve_by_url` part, avec ce `track_id` et cette URL
**AND** `urlRecoveryBusy` contient ce morceau

### Scénario 3 : Réponse réussie
**GIVEN** un geste en vol sur un morceau
**WHEN** le sidecar émet `track_resolved` en `url` pour ce morceau
**THEN** l'attente du morceau est levée, sans erreur
**AND** la ligne du run passe en `resolved`, résolution `url`

### Scénario 4 : Erreur rattachée à son morceau
**GIVEN** un geste en vol sur un morceau
**WHEN** le sidecar émet `error` de code `track_not_found`, `command` `resolve_by_url`, `params.track_id` à ce morceau
**THEN** l'attente du morceau est levée
**AND** `urlRecoveryErrors` rend cette erreur pour ce morceau, aucune pour les autres

### Scénario 5 : Morceaux à afficher
**GIVEN** un run dont un morceau est résolu en `auto`, un `unresolved`, un résolu en `url` et un en attente d'arbitrage
**WHEN** l'écran lit `recoverableTracks`
**THEN** il reçoit le morceau `unresolved` et le morceau résolu en `url`, dans l'ordre du run

### Scénario 6 : Cycle de vie
**GIVEN** la phase ouverte avec une erreur sur un morceau
**WHEN** l'utilisateur lance un nouveau run, ou le process du sidecar s'arrête
**THEN** la phase est fermée, sans attente ni erreur

## Tests à écrire

### Unit
- `src/app/core/url-recovery.store.spec.ts` :
  - opens on the first progress
  - marks a track busy until its resolution or its error
  - keeps the error of a track until its next gesture
  - clears the phase
- `src/app/core/sidecar.service.spec.ts` :
  - sends a url recovery command with its track and its url
  - ignores a second gesture while the first one waits
  - ignores an empty url
  - routes the url recovery progress to its phase only
  - releases a gesture on its resolution
  - attaches a url recovery error to its track
  - lists the unresolved tracks and those resolved by url
  - closes the phase when a new run starts or the process ends

Aucun test ne vérifie Angular, les signals ni Vitest : chacun échoue contre une régression de notre routage, de notre attente par morceau ou de notre cycle de vie. Le maintien de la phase à `cancelTagging` n'a pas de test : la phase ne peut pas être ouverte pendant un run en cours, seul moment où l'annulation agit, et sa progression arrive après.

## Edge cases

- **Erreur `resolve_by_url` sans `track_id`** (`malformed_command` ou `sidecar_unavailable`) : gardée dans `lastError`, aucun morceau touché. L'URL vide est filtrée avant l'envoi, la mort du process vide tout.
- **`progress(url_recovery)` reçu avant `run_finished`** : impossible côté sidecar ; s'il arrivait, la phase s'ouvrirait, l'écran restant gouverné par ce que le sidecar émet.
- **`track_resolved` en `url` pour un morceau sans geste en vol** (réponse arrivée après un `clear`) : la ligne du run se met à jour, le store n'a rien à lever.
- **Erreur puis correction réussie** : l'erreur s'efface au nouveau geste, avant même la réponse.

## Architectural decisions

### Décision : Garde de fermeture pendant un geste de rattrapage

**Options envisagées :**
- **A. Ne pas compter le geste en vol** : la garde de fermeture reste sur l'extraction, le run et la file d'arbitrage.
- **B. Compter les gestes en vol** comme travail en cours : une confirmation de plus pour un appel de quelques secondes.

**Choix : A**

**Rationale :**
- Validé par le propriétaire le 2026-10-03. Un geste dure le temps d'un appel à l'API, et fermer perd de toute façon tout le run, tenu en mémoire jusqu'à la Feature 6.
- Un morceau rattrapé mais non écrit relève de la confirmation d'écriture (Feature 5) et du plan de run (Feature 6), comme un morceau résolu automatiquement.

### Décision : Ouverture de la phase côté interface

**Options envisagées :**
- **A. Ouverte à la première progression `url_recovery` reçue** : l'interface lit ce que le sidecar décide.
- **B. Ouverte à `run_finished(network)` ou à l'annulation**, déduite par l'interface : seconde copie de la règle d'ouverture du sub-project 03.

**Choix : A**

**Rationale :**
- La règle d'ouverture est métier et vit dans le sidecar (`.claude/CLAUDE.md` § Standards) ; le sub-project 03 émet justement une progression à chaque ouverture.
- Une seule source : un changement de la règle côté sidecar ne demande rien à l'interface.
