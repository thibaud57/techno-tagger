---
feature: "Feature 3 : Arbitrage utilisateur"
subproject: "service-arbitrage-ui"
goal: "Porter côté webview la file des arbitrages en attente, alimentée par les événements du sidecar, et émettre les décisions de l'utilisateur"
status: "draft"
complexity: "M"
tdd_scope: "full"
depends_on: ["02-protocole-ndjson-arbitrage-design.md"]
date: "2026-09-26"
---

# File d'arbitrage côté webview

## Scope

Couvre le miroir TypeScript du contrat de l'arbitrage, un `ArbitrationStore` qui tient la file en ordre d'arrivée, l'arbitrage courant, la navigation, le compteur et l'attente d'une réponse par morceau, et `SidecarService` qui route les événements vers lui, envoie les trois gestes et en délègue la lecture.

Exclut tout composant et la visibilité de la modale (ouverture, croix, réouverture), portés par le sub-project 04, et la confirmation de sortie (sub-project 05).

### État livré

À la fin de ce sub-project, on peut : lancer `pnpm exec ng test --watch=false` et voir passer une suite Vitest où une séquence d'événements simulés remplit la file et son compteur, un geste envoie la bonne commande et bloque le morceau jusqu'à sa réponse, et l'arbitrage quitte la file à réception de `track_resolved`.

## Dependencies

- `02-protocole-ndjson-arbitrage-design.md` (statut: draft) : commandes `resolve_arbitration` et `switch_arbitration_source`, événements `arbitration_required` et `arbitration_updated` et leurs champs, erreurs `arbitration_*` portant `command` et `params.track_id`.

## Files touched

- **À modifier** : `src/app/core/models/protocol.ts` (`ArbitrationSource`, deux commandes, `CandidatePayload` étendu, `ArbitrationState`, `ArbitrationUpdatedEvent`, unions)
- **À créer** : `src/app/core/arbitration.store.ts`
- **À créer** : `src/app/core/arbitration.store.spec.ts`
- **À modifier** : `src/app/core/sidecar.service.ts` (routage, trois gestes, navigation, lecture déléguée, vidage de la file)
- **À modifier** : `src/app/core/sidecar.service.spec.ts`
- **À modifier** : `src/app/core/tagging-run.store.spec.ts` (fixture `AWAITING` aux nouveaux champs du contrat)

## Architecture approach

- **Miroir du contrat** (`.claude/rules/typescript/types.md`), maintenu à la main en face de `protocol.py` :
  - `ArbitrationSource = "beatport" | "bandcamp"`, les deux seules sources qu'un arbitrage met en jeu ;
  - `ResolveArbitrationCommand` (`track_id`, `source`, `candidate: number | null`) et `SwitchArbitrationSourceCommand` (`track_id`, `source`) rejoignent `SidecarCommand` ;
  - `CandidatePayload` gagne `label: string | null` et `year: number | null` ;
  - `ArbitrationState` (`track_id`, `source`, `beatport_unavailable`, `candidates`, `empty_reason`, `other_source`), étendu par `ArbitrationRequiredEvent` et `ArbitrationUpdatedEvent`. Le second rejoint `SidecarEvent` et `KNOWN_EVENTS`, l'exhaustivité par `never` du `switch` le rend obligatoire.
- **`ArbitrationStore`** (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`), un service d'état par phase comme `TaggingRunStore`, jamais injecté dans un composant :
  - **état privé** : la file en `Map` par `track_id`, dans l'ordre d'arrivée des `arbitration_required` ; l'ensemble des morceaux en attente d'une réponse ; l'arbitrage courant, `linkedSignal` sur les clés de la file ;
  - **lecture** : `entries`, `current` (ou `null`), `position` (1-based) et `count` pour le « 1/3 », `hasPrevious`, `hasNext`, `currentBusy` ;
  - **mutations** : `required(event)` ajoute en fin, ou remplace en place un morceau déjà dans la file ; `updated(event)` remplace en place et lève l'attente ; `resolved(trackId)` retire et lève l'attente ; `rejected(trackId, code)` lève l'attente et retire sur `arbitration_not_pending` ; `sent(trackId)` pose l'attente ; `previous()` et `next()` naviguent, bornés ; `clear()` vide tout.
- **Arbitrage courant** : un nouvel arbitrage ne change jamais le courant, sauf file vide. Quand le courant quitte la file, le suivant prend sa position, le précédent s'il était le dernier, `null` si la file se vide. C'est ce qui garde la main de l'utilisateur sur une file qui bouge pendant que le pipeline tourne.
- **`SidecarService`**, seule frontière injectée par les composants :
  - **gestes** : `chooseCandidate(trackId, source, index)`, `refuseCandidates(trackId, source)`, `showArbitrationSource(trackId, source)` posent l'attente puis envoient la commande. Un geste sur un morceau déjà en attente est ignoré sans envoi ;
  - **navigation** : `previousArbitration()` et `nextArbitration()` délèguent au store ;
  - **lecture déléguée** : `arbitrations`, `currentArbitration`, `arbitrationPosition`, `arbitrationCount`, `arbitrationBusy` ;
  - **routage** : `arbitration_required` vers `TaggingRunStore.awaiting` (puce de la ligne, inchangé) et `ArbitrationStore.required` ; `arbitration_updated` vers le store seul ; `track_resolved` vers les deux ; une `error` dont `command` vaut `resolve_arbitration` ou `switch_arbitration_source` et dont `params.track_id` est une chaîne vers `rejected`, en restant aussi dans `lastError` pour `errorFor(...)` ;
  - **cycle de vie** : la file se vide à `startTagging`, avec `reset()`, puisque le sidecar jette l'ancien run, et à la mort du process (`endRun`), plus personne ne pouvant répondre. Elle survit à `cancelTagging` (décision du 2026-09-26, sub-project 01).
- **Aucune logique métier** : l'ordre des candidats, leurs scores et la source affichée viennent du sidecar, le store ne fait que les garder et les rendre.

## Acceptance criteria

### Scénario 1 : File et compteur
**GIVEN** une file vide
**WHEN** trois `arbitration_required` arrivent
**THEN** la file compte trois arbitrages dans leur ordre d'arrivée
**AND** le premier est courant, en position 1 sur 3

### Scénario 2 : Arrivée pendant la décision
**GIVEN** une file dont le deuxième arbitrage est courant
**WHEN** un nouvel `arbitration_required` arrive
**THEN** le deuxième reste courant et le compteur passe à 2 sur 4

### Scénario 3 : Refus et attente
**GIVEN** un arbitrage courant sur Beatport
**WHEN** l'utilisateur le refuse, puis le refuse de nouveau avant toute réponse
**THEN** une seule commande `resolve_arbitration` part, avec `source` à `beatport` et `candidate` à `null`
**AND** l'arbitrage est en attente jusqu'à l'`arbitration_updated` qui affiche Bandcamp, à la même position

### Scénario 4 : Résolution
**GIVEN** une file de trois arbitrages dont le deuxième est courant
**WHEN** `track_resolved` arrive pour le deuxième
**THEN** la file en compte deux et l'ancien troisième devient courant, en position 2 sur 2

### Scénario 5 : Désynchronisation
**GIVEN** un arbitrage en attente d'une réponse
**WHEN** une `error` `arbitration_not_pending` arrive pour ce morceau
**THEN** il quitte la file, et l'erreur reste lisible par `errorFor("resolve_arbitration")`

### Scénario 6 : Nouveau run et fin du process
**GIVEN** une file de deux arbitrages
**WHEN** l'utilisateur lance un nouveau run, ou le process du sidecar meurt
**THEN** la file est vide
**AND** après une interruption par `cancelTagging`, elle reste intacte

## Tests à écrire

### Unit
- `src/app/core/arbitration.store.spec.ts` :
  - queues arbitrations in arrival order and counts them
  - keeps the current arbitration when a new one arrives
  - replaces an arbitration in place when it is updated
  - moves to the next arbitration when the current one is resolved
  - moves to the previous one when the last one is resolved
  - leaves no current arbitration once the queue is empty
  - navigates between arbitrations within bounds
  - marks a track busy until its update, its resolution or its error (paramétré)
  - drops an arbitration the sidecar no longer holds
  - keeps an arbitration rejected for another reason
  - ignores an update for a track outside the queue
- `src/app/core/sidecar.service.spec.ts` :
  - sends a choice, a refusal and a switch with its command (paramétré)
  - ignores a second gesture on a track awaiting an answer
  - routes the arbitration events to the queue
  - releases a gesture the sidecar refuses
  - keeps a gesture waiting when the error names no track
  - leaves the queue alone on the error of another command
  - clears the queue when a new run starts and when the process dies (paramétré)
  - keeps the queue after a cancellation

Aucun test ne vérifie Angular : `signal` et `linkedSignal` ne sont jamais testés pour eux-mêmes, chaque cas échoue contre une régression de nos règles de file, d'attente ou de routage.

## Edge cases

- **`arbitration_updated` ou `track_resolved` pour un morceau absent de la file** : ignoré par le store, sans erreur ; `track_resolved` reste routé vers `TaggingRunStore`, qui connaît tous les morceaux du run.
- **Erreur d'arbitrage sans `params.track_id` exploitable** : aucune attente levée, l'erreur reste dans `lastError`.
- **`arbitration_candidate_unknown` ou `arbitration_busy`** : l'attente est levée, l'arbitrage reste en file ; la réponse du premier geste arrive par ailleurs.
- **Navigation en bout de file** : `previous()` sur le premier et `next()` sur le dernier sont sans effet.
- **Geste alors que le process est mort** : `send` le signale déjà en `sidecar_unavailable`, et `endRun` vide la file.

## Architectural decisions

### Décision : Où vit la file côté webview

**Options envisagées :**
- **A. Un `ArbitrationStore` en ordre d'arrivée** : un nouvel arbitrage s'ajoute en fin, celui qu'on regarde ne bouge jamais ; la ligne du run garde son propre drapeau.
- **B. Une file dérivée des lignes de `TaggingRunStore`** : une seule source de vérité, mais dans l'ordre du dossier, où un morceau entré en zone grise avant celui qu'on regarde le décale.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- La modale est le seul écran à cadence rapide (DESIGN.md § Layout) : un compteur qui passe de « 1/3 » à « 2/4 » sous les yeux fait valider le mauvais morceau, et l'erreur ne se voit qu'à l'écriture.
- Un store par phase est la règle du projet (`.claude/rules/angular/services.md`), annoncée par `TaggingRunStore` pour les Features 3 à 6.
