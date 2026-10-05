---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "protocole-ndjson-rattrapage"
goal: "Exposer le rattrapage par URL sur le protocole NDJSON par la commande `resolve_by_url`, l'ouverture de sa phase et sa progression"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-rattrapage-url-sidecar-design.md"]
date: "2026-10-02"
---

# Protocole NDJSON du rattrapage par URL

## Scope

Couvre la commande `resolve_by_url` (modèle, unions, dispatch, geste en tâche de fond), le branchement d'`UrlRecovery` dans le run courant, l'ouverture de la phase de rattrapage (après `run_finished(network)` ou après un `cancel_run` qui a interrompu la phase réseau) et son refus tant qu'elle n'est pas ouverte, l'émission de `progress` en phase `url_recovery`, le `track_id` joint à toute erreur d'un geste, et le miroir TypeScript de la commande.

Exclut le service et le store Angular (sub-project 04), l'écran (sub-project 05), le bouton de confirmation et `commit_run` (Feature 5) et la persistance de la décision (Feature 6).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer des tests d'intégration qui, en conversant avec la boucle NDJSON sur une API simulée, reçoivent `progress(url_recovery)` à la fin de la phase réseau, rattrapent un morceau par `resolve_by_url` jusqu'à `track_resolved` en `url` et sa progression, et lisent chaque refus en `error` portant `command` et `params.track_id`.

## Dependencies

- `02-rattrapage-url-sidecar-design.md` (statut: draft) : `UrlRecovery`, `UrlProgress`, `UrlRecoveryEvent`, erreurs `UrlRecovery*`, `TrackRecord.resolved` sans score.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (`ResolveByUrl`, `AnyCommand`, `ExecutableCommand`, `CommandName`, `error_from_business` avec `track_id`)
- **À modifier** : `sidecar/src/tagger/url_recovery.py` (`UrlRecoveryNotOpenError`, code `url_recovery_not_open`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`CurrentRun.url_recovery`, `open_tagging`, `_relay`, `to_protocol_event`, `handle_start_tagging` qui ouvre la phase)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`_Session.resolve_by_url`, ouverture de la phase sur `cancel_run`, progression après un geste d'arbitrage, `track_id` des erreurs de geste, dispatch)
- **À modifier** : `src/app/core/models/protocol.ts` (`ResolveByUrlCommand` dans `SidecarCommand`)
- **À créer** : `sidecar/tests/unit/test_protocol_url_recovery.py` (modèle de la commande, traduction de la progression, erreur d'un geste)
- **À créer** : `sidecar/tests/integration/test_ndjson_url_recovery.py` (conversation de bout en bout)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.url_recovery_not_open`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : lignes `resolve_by_url`, `progress`, `cancel_run`, `error`)

## Architecture approach

- **Patron de l'arbitrage** (spec `arbitrage-utilisateur/02-protocole-ndjson-arbitrage-design.md`) : le run courant (`CurrentRun`) survit à sa phase réseau jusqu'au run suivant, au `shutdown` ou à l'EOF. Il porte aussi `url_recovery`, instanciée dans `open_tagging` avec le même `relay` que l'arbitrage et le pipeline. Les gestes de rattrapage passent par `CurrentRun.track`, et `close` les annule comme ceux de l'arbitrage.
- **Commande** `ResolveByUrl(Command)` : `command: Literal["resolve_by_url"]`, `track_id: str`, `url` chaîne non vide, héritant `extra="forbid"`, `frozen` et `strict` de `Command` (ADR-022, `.claude/rules/pydantic/modeles.md`). Ajoutée à `AnyCommand`, `ExecutableCommand` et `CommandName`, que `test_command_name_lists_every_command` garde alignés. Le dispatch gagne un cas, fermé par `assert_never` (`.claude/rules/python/pattern-matching.md`).
- **Geste en tâche de fond**, comme `resolve_arbitration` : l'appel réseau ne gèle jamais la lecture de `stdin` (ARCHITECTURE.md § Concurrence). `_Session.resolve_by_url` vérifie l'ouverture de la phase dans la boucle, puis lance `url_recovery.resolve` dans le `TaskGroup` de la session par `_phase`.
- **Ouverture de la phase** (décision du 2026-10-02) : la phase de rattrapage est ouverte dès qu'il y a un run courant dont la phase réseau ne tourne plus, terminée ou interrompue. Le spec F2 `11-interruption-du-run-design.md` laisse en effet l'écriture disponible après une interruption, et le rattrapage la précède. Sans run courant, ou tant que la phase réseau tourne, `resolve_by_url` lève `UrlRecoveryNotOpenError` (`url_recovery_not_open`, `params.track_id`), définie dans `url_recovery.py` à côté des autres erreurs de la famille.
- **Progression de la phase** (`progress`, phase `url_recovery`) :
  - à l'ouverture : `handle_start_tagging` émet `run_finished(network)` puis la progression d'`url_recovery.progress()`, et ne rend plus d'événement à `_phase` ; `cancel_run` l'émet aussi, seulement quand il a réellement interrompu une phase réseau d'un run courant. `cancel_run` reste sans événement de fin (ARCHITECTURE.md § API) ;
  - après un rattrapage réussi : émise par `UrlRecovery` elle-même (sub-project 02) ;
  - après un geste d'arbitrage, une fois la phase ouverte : émise par la session à la fin du geste, puisqu'un refus tardif grossit le total. Un geste d'arbitrage pendant la phase réseau n'en émet pas.
  `to_protocol_event` gagne le seul cas `UrlProgress`, traduit en `Progress(phase=Phase.URL_RECOVERY)`. Le `TrackResolved` d'un rattrapage est celui de `tagging`, déjà traduit par `_resolved`, qui rend `scores` absent pour un `scored` nul.
- **Erreurs d'un geste** : toute `error` née d'une commande qui vise un morceau (`resolve_arbitration`, `resolve_by_url`) porte `params.track_id`, joint par `error_from_business` à partir de la commande. Les erreurs du client (`unsupported_url`, `track_not_found`, `source_unavailable`, `api_key_rejected`, `api_contract_error`) n'en portaient pas : l'interface les affichera sur la bonne ligne (sub-project 05). Une erreur portant `resolve_by_url` ne clôt jamais le run côté interface (ARCHITECTURE.md § API, « Seul l'échec de la commande qui a ouvert un run le clôt »).
- **Miroir TypeScript** : `ResolveByUrlCommand` (`command`, `track_id`, `url`) rejoint `SidecarCommand` dans `protocol.ts`, maintenu à la main (en-tête du fichier, `.claude/rules/pydantic/modeles.md`). `Phase` porte déjà `url_recovery`, `TrackResolution` déjà `url` : aucun événement nouveau, `KNOWN_EVENTS` inchangé.
- **Docs** : ARCHITECTURE.md se modifie avec le skill `architecture-doc`.
- **Qualité** : Ruff, Mypy strict, ESLint et `tsc` sur `protocol.ts` (`.claude/rules/typescript/types.md`), tests selon `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : Ouverture de la phase en fin de run
**GIVEN** un run dont l'unique morceau finit `unresolved`
**WHEN** la phase réseau se termine
**THEN** la boucle émet `run_finished` de phase `network`
**AND** puis `progress` de phase `url_recovery`, `processed` 0, `total` 1

### Scénario 2 : Rattrapage de bout en bout
**GIVEN** la phase de rattrapage ouverte et une API qui rend un `Track` Bandcamp pour l'URL collée
**WHEN** l'interface envoie `resolve_by_url` avec ce morceau et cette URL
**THEN** la boucle émet `track_resolved` en `resolved`, `resolution` à `url`, `source` à `bandcamp`, sans `scores`
**AND** puis `progress` de phase `url_recovery`, `processed` 1, `total` 1

### Scénario 3 : Erreur du client rattachée à son morceau
**GIVEN** la phase de rattrapage ouverte
**WHEN** l'interface envoie `resolve_by_url` avec une URL YouTube
**THEN** la boucle émet `error` de code `unsupported_url`, `command` à `resolve_by_url`, `params.track_id` au morceau

### Scénario 4 : Phase non ouverte
**GIVEN** aucun run, puis un run dont la phase réseau est retenue par l'API
**WHEN** l'interface envoie `resolve_by_url` dans chacun des deux cas
**THEN** la boucle émet chaque fois `error` de code `url_recovery_not_open`, `command` à `resolve_by_url`, `params.track_id` au morceau

### Scénario 5 : Ouverture après une interruption
**GIVEN** un run dont la phase réseau est retenue par l'API après un premier morceau `unresolved`
**WHEN** l'interface envoie `cancel_run`
**THEN** la boucle émet `progress` de phase `url_recovery` sans `run_finished`
**AND** un `resolve_by_url` sur le morceau `unresolved` aboutit en `track_resolved`

### Scénario 6 : Progression après un refus d'arbitrage tardif
**GIVEN** la phase de rattrapage ouverte, un morceau `unresolved` et un morceau en attente d'arbitrage dont Bandcamp ne trouve rien
**WHEN** l'interface refuse Beatport puis passe la liste Bandcamp vide
**THEN** la boucle émet `track_resolved` en `unresolved`
**AND** puis `progress` de phase `url_recovery` dont `total` passe de 1 à 2

### Scénario 7 : Commande malformée
**GIVEN** la boucle en attente
**WHEN** l'interface envoie `resolve_by_url` sans `url`, avec une `url` vide ou avec un champ en trop
**THEN** la boucle émet `error` de code `malformed_command`, sans geste lancé

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_protocol_url_recovery.py` :
  - accepts a url recovery command
  - rejects a malformed url recovery command (paramétré : `missing-url`, `empty-url`, `numeric-url`, `extra-field`)
  - translates the url progress into a url recovery progress
  - joins the track to the error of a gesture
  - leaves the error of a command without track untouched

### Integration
- `sidecar/tests/integration/test_ndjson_url_recovery.py` :
  - opens the url recovery phase once the network phase is finished
  - resolves a track by url end to end
  - reports a client error with its command and its track
  - reports a track that is not eligible with its command and its track
  - refuses a url before any run
  - refuses a url while the network phase is running
  - opens the url recovery phase when the run is cancelled
  - reports the url progress after a late arbitration refusal
  - cancels a url gesture in flight when a new run starts

`test_command_name_lists_every_command` couvre sans ajout l'alignement de `CommandName`, `test_error_translations.py` la traduction de `url_recovery_not_open`. Aucun test ne vérifie pydantic lui-même : chaque cas échoue contre une régression de notre modèle, de notre règle d'ouverture, de nos moments d'émission ou de notre rattachement des erreurs.

## Edge cases

- **`cancel_run` sans run en cours** : aucun événement, comme avant (`test_a_cancelled_run_leaves_the_loop_alive`).
- **Run qui s'arrête sur trois 403** : `start_tagging` finit en `error`, l'interface clôt le run, aucune phase de rattrapage ne s'ouvre ; un `resolve_by_url` suivant trouve le run courant sans phase réseau active et passe par l'éligibilité normale.
- **Nouveau run pendant un geste en vol** : le run courant est fermé, le geste annulé, aucun événement ne sort pour l'ancien morceau ; un `resolve_by_url` arrivé pendant l'ouverture du nouveau run est refusé en `url_recovery_not_open`.
- **`shutdown` pendant un geste** : la boucle s'arrête sans attendre l'API, comme pour l'arbitrage.
- **Arbitrage choisi après la phase réseau** : suivi d'une progression inchangée, émise quand même (un calcul plutôt qu'une comparaison avec l'émission précédente).

## Architectural decisions

### Décision : Ouverture de la phase de rattrapage

**Options envisagées :**
- **A. Run courant dont la phase réseau ne tourne plus, terminée ou interrompue** : un run interrompu garde son rattrapage, comme il garde son écriture.
- **B. Seulement après `run_finished(network)`** : un run interrompu n'offre aucun rattrapage, ses non résolus partent tels quels à l'écriture.
- **C. Dès le premier non résolu, phase réseau en cours** : aucune règle d'ouverture, mais deux progressions entremêlées et un écart au use-case 4 (« Une fois le pipeline terminé »).

**Choix : A**

**Rationale :**
- Validé par le propriétaire le 2026-10-02. Le spec F2 `11-interruption-du-run-design.md` laisse la confirmation d'écriture disponible après une interruption : le rattrapage, qui la précède, doit l'être aussi.
- « Phase réseau en cours » se lit déjà par la tâche du run (`_active_run`), sans état supplémentaire.

### Décision : Rattachement des erreurs d'un geste à leur morceau

**Options envisagées :**
- **A. `error_from_business` joint `track_id` depuis la commande** pour tout geste sur un morceau : une règle, au seul endroit qui connaît la commande.
- **B. `UrlRecovery` enveloppe les erreurs du client** dans une erreur portant `track_id` : un code de plus, qui masque `unsupported_url` ou `track_not_found` derrière un code générique.

**Choix : A**

**Rationale :**
- Le code d'origine reste lisible par l'interface, qui traduit `unsupported_url` et `track_not_found` différemment.
- Les erreurs `arbitration_*` portent déjà `track_id` : la jointure est sans effet sur elles.
