---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "service-sidecar-tagging"
goal: "Porter côté webview l'état d'un run de re-tagging, alimenté par les événements du sidecar"
status: "implemented"
complexity: "M"
tdd_scope: "partial"
depends_on: ["07-protocole-ndjson-tagging-design.md"]
date: "2026-09-20"
---

# État du run de re-tagging côté webview

## Scope

Couvre le miroir TypeScript des messages du run (`start_tagging`, `run_started`, `track_resolved`, `arbitration_required`, `run_finished`, et `progress` en phase `tagging`), un store dédié qui tient l'état du run en signals, et le routage des événements depuis `SidecarService`, qui expose le tout par délégation. Couvre aussi la précision de la rule `angular/services.md` sur le découpage retenu.

Exclut l'affichage (sub-projects 09 et 10), la famille visuelle d'un état, dérivée par `StateTagComponent` (sub-project 09), la file d'arbitrage et sa modale (Feature 3), et tout calcul métier : le store range ce qu'il reçoit, il ne décide de rien.

### État livré

À la fin de ce sub-project, on peut : lancer `pnpm test` et voir passer un test qui rejoue une séquence complète d'événements sur le transport simulé, puis vérifie que chaque morceau porte l'état attendu, que la progression avance, que les compteurs de fin de phase réseau sont remplis et que le run est terminé.

## Dependencies

- `07-protocole-ndjson-tagging-design.md` (statut: implemented) : la forme exacte des messages, dont ce miroir TypeScript est la copie maintenue à la main.

## Files touched

- **À modifier** : `src/app/core/models/protocol.ts` (commande et événements du run, unions)
- **À créer** : `src/app/core/tagging-run.store.ts` (état du run en signals)
- **À créer** : `src/app/core/tagging-run.store.spec.ts`
- **À modifier** : `src/app/core/sidecar.service.ts` (`startTagging`, routage, délégation)
- **À modifier** : `src/app/core/sidecar.service.spec.ts` (séquence d'un run)
- **À modifier** : `.claude/rules/angular/services.md` (découpage frontière et store)

## Architecture approach

- **Miroir maintenu à la main** (`core/models/protocol.ts`), sans génération de code, comme le reste du contrat. Les champs d'état sont des unions littérales (`"resolved" | "unresolved"`, `"auto" | "arbitration" | "url" | "none"`, les motifs d'échec) : sans littéral, aucun narrowing, et le `switch` du service ne serait plus vérifié (`.claude/rules/typescript/types.md`).
- **`KNOWN_EVENTS` et le `switch` exhaustif restent la garde** : ajouter un événement côté sidecar sans le traiter ici devient une erreur de compilation, jamais une ligne perdue en silence.
- **Un store dédié** `TaggingRunStore` dans `core/` (décision du 2026-09-20) : `SidecarService` reste la frontière du transport, de la version et des erreurs, et le store tient l'état d'une phase. Sans ce découpage, `SidecarService` porterait aussi l'arbitrage, le rattrapage, l'écriture et le récapitulatif des Features 3 à 6. La rule `angular/services.md` est précisée dans le même commit.
- **État du store** : `runId`, l'ordre des `track_id` et une `Map` vers la ligne de chaque morceau. Une ligne porte l'identité lue, `state`, `resolution`, `failure_reason`, `source`, l'artiste et le titre « après », les scores, le chemin de la pochette et l'attente d'arbitrage. Tout vient du sidecar, rien n'est calculé (`.claude/rules/angular/services.md`).
- **Signals en lecture seule** (`.claude/rules/angular/signals.md`) : `tracks` (les lignes dans l'ordre du run, dérivées par `computed`), `progress`, `running` (vrai de `start_tagging` jusqu'à `run_finished` ou une erreur), `finished` (les compteurs de fin de phase réseau, que le signal sonore du sub-project 10 écoutera). Les écritures passent par des méthodes, jamais par un signal exposé en écriture.
- **Nouvelle référence à chaque mise à jour** : une ligne modifiée produit une nouvelle `Map` et un nouvel objet. Muter en place ne notifierait aucun consommateur.
- **Routage dans `SidecarService`** : `startTagging(folder, thresholds?)` réinitialise le store puis envoie la commande. À la réception, `run_started`, `track_resolved`, `arbitration_required` et `run_finished` vont au store, et `progress` est réparti par phase : `extraction` alimente le signal existant, `tagging` le store. Une erreur reçue pendant un run arrête le run dans le store, comme `endRun` le fait déjà pour l'extraction.
- **Délégation** : le service expose `taggingTracks`, `taggingProgress`, `tagging` et `taggingFinished`, pour que les composants n'injectent que `SidecarService`, comme l'onglet Playlist le fait aujourd'hui.
- **Aucun RxJS** : le flux est déjà découpé en lignes par Tauri et aucun opérateur ne s'applique, le handler écrit donc directement dans les signals (`.claude/rules/angular/rxjs-interop.md`).

## Acceptance criteria

### Scénario 1 : Liste affichée dès le départ
**GIVEN** un run lancé sur trois morceaux
**WHEN** `run_started` arrive
**THEN** les trois lignes existent dans l'ordre du run, avec leur identité lue et sans état

### Scénario 2 : Morceau résolu
**GIVEN** une ligne en attente
**WHEN** son `track_resolved` arrive
**THEN** la ligne porte son état, sa source, son « après », ses scores et sa pochette

### Scénario 3 : Morceau en attente d'arbitrage
**GIVEN** une ligne en attente
**WHEN** son `arbitration_required` arrive
**THEN** la ligne porte son attente d'arbitrage, et reste sans état

### Scénario 4 : Fin de la phase réseau
**GIVEN** un run en cours
**WHEN** `run_finished` arrive en phase `network`
**THEN** les compteurs sont exposés, et le run n'est plus en cours

### Scénario 5 : Progressions séparées
**GIVEN** un run de re-tagging en cours
**WHEN** un `progress` de phase `extraction` arrive
**THEN** la progression du run ne bouge pas

### Scénario 6 : Second run
**GIVEN** un run terminé et ses lignes affichées
**WHEN** un nouveau run est lancé
**THEN** les lignes précédentes disparaissent avant l'arrivée du nouveau `run_started`

### Scénario 7 : Erreur pendant un run
**GIVEN** un run en cours
**WHEN** un `error` arrive
**THEN** le run n'est plus en cours, et l'erreur est lisible par les composants

## Tests à écrire

### Unit
- `src/app/core/tagging-run.store.spec.ts` :
  - lists every track of a started run in order
  - updates a track with its state, source, names, scores and artwork
  - marks a track as awaiting arbitration
  - exposes the counters of a finished network phase
  - clears the previous run when a new one starts
  - stops the run on failure
- `src/app/core/sidecar.service.spec.ts` (ajouts) :
  - sends the start tagging command with and without thresholds (paramétré)
  - replays a whole tagging run and reports every track
  - keeps the extraction progress out of the tagging run

Aucun test ne vérifie Angular lui-même : chacun échoue contre une régression de notre routage d'événements ou de notre état de run.

## Edge cases

- **`track_resolved` pour un `track_id` inconnu** (contrat désynchronisé) : ignoré, avec une trace en console, comme une ligne NDJSON illisible.
- **`run_started` vide** : aucune ligne, progression à zéro, le run se termine aussitôt.
- **Pochette absente** : `artwork_path` vaut `null`, la ligne reste valide.
- **`run_finished` en phase `write`** (Feature 5) : ignoré par ce store, qui ne suit que la phase réseau.
- **Mort du sidecar pendant un run** : `available` passe à faux, le run s'arrête, les lignes déjà reçues restent affichées.

## Architectural decisions

### Décision : Où vit l'état du run

**Options envisagées :**
- **A. Un store dédié dans `core/`, alimenté par `SidecarService`** : la frontière reste au service, l'état d'une phase vit à côté, et les Features 3 à 6 ajouteront leur propre store.
- **B. Tout dans `SidecarService`** : conforme à la lettre de la rule actuelle, au prix d'un fichier qui doublera avec l'arbitrage, le rattrapage, l'écriture et le récapitulatif.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20.
- La rule dit aussi « un service d'état par feature » : elle est précisée dans le même commit pour lever l'ambiguïté.
- Les composants continuent de n'injecter que `SidecarService`, qui délègue : le découpage ne se voit pas depuis les écrans.
