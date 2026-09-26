---
feature: "Feature 3 : Arbitrage utilisateur"
subproject: "protocole-ndjson-arbitrage"
goal: "Exposer l'arbitrage sur le protocole NDJSON et garder le run arbitrable, client compris, au-delà de sa phase réseau"
status: "draft"
complexity: "M"
tdd_scope: "full"
depends_on: ["01-file-arbitrage-sidecar-design.md"]
date: "2026-09-26"
---

# Protocole NDJSON de l'arbitrage

## Scope

Couvre les commandes `resolve_arbitration` et `switch_arbitration_source`, l'événement `arbitration_updated`, l'extension d'`arbitration_required` et de `CandidatePayload` (label, année, liste vide, source réaffichable), la traduction des événements de l'arbitrage, et le run courant tenu par la session de la boucle : ouvert par `start_tagging`, gardé avec son client après `run_finished` comme après `cancel_run`, fermé au run suivant, au `shutdown` et à l'EOF. Les gestes réseau tournent en tâche de fond.

Exclut le miroir TypeScript et toute interface (sub-projects 03 et 04), et toute logique d'arbitrage, portée par le sub-project 01.

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite d'intégration qui converse avec la boucle NDJSON, injecte `start_tagging`, refuse Beatport par `resolve_arbitration`, reçoit `arbitration_updated` avec la liste Bandcamp, revient à Beatport, puis choisit un candidat et reçoit `track_resolved` en `arbitration`, après `run_finished`.

## Dependencies

- `01-file-arbitrage-sidecar-design.md` (statut: draft) : `LiveRun`, `open_run`, `resolve_run`, `RunSources`, `Arbitration` (`choose`, `refuse(track_id, source)`, `show`), `ArbitrationUpdated`, `PendingArbitration` (`empty_reason`, `other`), erreurs `arbitration_*` déjà traduites.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (commandes `ResolveArbitration` et `SwitchArbitrationSource`, unions `AnyCommand`, `ExecutableCommand`, `CommandName`, `CandidatePayload` étendu, `ArbitrationRequired` étendu, `ArbitrationUpdated`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`CurrentRun`, `open_tagging`, phase réseau sur le run courant, traduction des événements de l'arbitrage, `_arbitration` étendu)
- **À modifier** : `sidecar/src/tagger/__main__.py` (run courant de `_Session`, dispatch des deux commandes, gestes en tâche de fond, fermeture au `shutdown` et à l'EOF)
- **À modifier** : `sidecar/tests/helpers/ndjson_loop.py` (conversation avec la boucle : stdin alimenté par une file, attente d'un événement avant la commande suivante)
- **À modifier** : `sidecar/tests/integration/test_ndjson_loop.py` (fixture du run sans fin : troisième paramètre de `handle_start_tagging`)
- **À créer** : `sidecar/tests/unit/test_protocol_arbitration.py`
- **À créer** : `sidecar/tests/integration/test_ndjson_arbitration.py`
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : champs de `resolve_arbitration`, `switch_arbitration_source`, `arbitration_required`, `arbitration_updated`, ligne `shutdown` ; § Concurrence : gestes en tâche de fond, run courant fermé au run suivant)

## Architecture approach

- **Commandes** (`.claude/rules/pydantic/modeles.md`), fermées et strictes comme les autres (ADR-022) :
  - `resolve_arbitration` : `track_id`, `source` limitée à `beatport` et `bandcamp` (la liste sur laquelle porte le geste), `candidate` (index ≥ 0 dans cette liste, ou `null` pour un refus explicite). `candidate` est obligatoire et sans défaut : l'interface dit toujours ce qu'elle veut. La source nommée protège d'un double clic arrivé après la bascule (décision du 2026-09-26, reportée dans le sub-project 01) ;
  - `switch_arbitration_source` : `track_id` et `source`, la liste mémorisée à réafficher.
  Un index négatif, une source `soundcloud` ou un `candidate` absent donnent `malformed_command` à la validation, par le chemin existant. `test_command_name_lists_every_command` garde la copie de `CommandName`.
- **Événements** :
  - `arbitration_required` et `arbitration_updated` portent les mêmes champs, l'état complet de l'arbitrage : `track_id`, `source` affichée, `beatport_unavailable`, `candidates`, `empty_reason` (`no_result`, `below_threshold`, `source_unavailable` ou `null`), `other_source` (la source que `switch_arbitration_source` peut réafficher, ou `null`). Un modèle de base commun les porte. Le premier ajoute un morceau à la file de l'interface, le second remplace une entrée déjà dans la file ;
  - `CandidatePayload` gagne `label` (`TrackCandidate.label.name`) et `year` (`TrackCandidate.release.release_date.year`), nullables. Toujours `null` sur Bandcamp, dont la recherche ne rend ni label ni date (`.claude/rules/techno-scraper/contrat.md`), parfois sur Beatport, dont les objets de recherche sont abrégés. Aucun refetch pour les remplir. L'index d'un candidat est sa position dans `candidates`, sans champ identifiant ;
  - un choix, un refus Bandcamp ou un « passer » produisent un `track_resolved`, déjà consommé par l'interface.
- **Run courant** : un `CurrentRun` dans `handlers.py` possède un `AsyncExitStack` (client techno-scraper et fetcher de pochettes), le `LiveRun`, les `RunSources`, l'`Arbitration` et les tâches de gestes en vol. `open_tagging(command, emit)` lit la clé (`api_key_missing` sinon), ouvre les deux caches, fait entrer le client et le fetcher dans la pile, appelle `open_run`, qui émet `run_started`, et branche l'`Arbitration` sur la traduction des événements. `close()` annule les gestes en vol, les attend et ferme la pile (`.claude/rules/python/asyncio.md`).
- **Session de la boucle** (`__main__.py`) :
  - `start_tagging` reste refusé en `tagging_in_progress` tant que la phase réseau tourne. Accepté, sa tâche de fond ferme le run courant, ouvre le nouveau, le confie à la session, déroule `resolve_run` et émet `run_finished` ;
  - `cancel_run` n'annule que la phase réseau : le run courant reste arbitrable (décision du 2026-09-26, sub-project 01) ;
  - `shutdown` annule la phase réseau puis ferme le run courant ; l'EOF attend la phase réseau puis le ferme ;
  - `resolve_arbitration` part en tâche de fond dans le `TaskGroup` de la boucle, référencée par le `CurrentRun`. Une `TaggerError` y devient un `error` qui nomme la commande, comme pour les phases longues ; toute autre exception fait tomber le process, volontairement ;
  - `switch_arbitration_source` n'a aucune I/O et s'exécute dans la boucle ;
  - sans run courant, un geste lève `arbitration_not_pending`.
- **Erreurs** (`.claude/rules/python/gestion-erreurs.md`) : un geste refusé sort en `error` avec `command` (`resolve_arbitration` ou `switch_arbitration_source`) et `params.track_id`. Aucun code nouveau : ceux du 01 sont déjà traduits.
- **Traduction** : `handlers.py` traduit `ArbitrationUpdated` en `arbitration_updated` et réutilise `_resolved` pour `TrackResolved`. Le dispatch des commandes reste fermé par `assert_never` (`.claude/rules/python/pattern-matching.md`).

## Acceptance criteria

### Scénario 1 : Refus puis choix
**GIVEN** un run dont le morceau « Your Mind » attend sur Beatport, phase réseau terminée
**WHEN** l'interface envoie un refus de Beatport, puis le choix du candidat Bandcamp d'index 0
**THEN** elle reçoit `arbitration_updated` avec `source` à `bandcamp` et `other_source` à `beatport`
**AND** puis `track_resolved` en `resolved` / `arbitration`, source Bandcamp

### Scénario 2 : Retour à Beatport
**GIVEN** le même morceau après la bascule sur Bandcamp
**WHEN** l'interface envoie `switch_arbitration_source` vers Beatport
**THEN** elle reçoit `arbitration_updated` avec la liste Beatport et `other_source` à `bandcamp`
**AND** aucune requête ne part vers l'API

### Scénario 3 : Arbitrage après une interruption
**GIVEN** un run interrompu par `cancel_run` avec un morceau déjà en attente
**WHEN** l'interface choisit un candidat
**THEN** elle reçoit `track_resolved` pour ce morceau

### Scénario 4 : Nouveau run
**GIVEN** un run terminé avec un morceau en attente
**WHEN** l'interface lance un nouveau run, puis envoie un geste sur ce morceau
**THEN** elle reçoit une `error` `arbitration_not_pending`, `command` à `resolve_arbitration`, `params.track_id` au morceau

### Scénario 5 : Boucle réactive
**GIVEN** un refus dont l'appel Bandcamp est en cours
**WHEN** l'interface envoie `get_version`
**THEN** elle reçoit `version` avant la fin de l'appel Bandcamp

### Scénario 6 : Commande malformée
**GIVEN** une ligne `resolve_arbitration` avec un index négatif, une source `soundcloud` ou sans `candidate`
**WHEN** elle arrive sur stdin
**THEN** l'interface reçoit une `error` `malformed_command`

### Scénario 7 : Label et année
**GIVEN** un morceau en attente sur Beatport dont les candidats portent label et date de sortie
**WHEN** `arbitration_required` est émis
**THEN** chaque candidat porte `label` et `year`, et un candidat Bandcamp porte `null` pour les deux

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_protocol_arbitration.py` :
  - accepts a choice and an explicit refusal
  - rejects a negative index, a soundcloud source and a missing candidate (et un booléen)
  - translates an update with the other source and the empty reason
  - carries the label and the release year of a beatport candidate
  - leaves the label and the year empty when the search omits them

### Integration
- `sidecar/tests/integration/test_ndjson_arbitration.py` :
  - refuses beatport then resolves the track on a bandcamp candidate
  - shows the beatport list again without calling the api
  - answers an awaiting track after the run is cancelled
  - drops the arbitrations of a run replaced by a new one
  - reports a rejected gesture with its command and its track
  - answers another command while a refusal waits for bandcamp
  - rejects a gesture before any run
  - shuts down without waiting for a refusal in flight
  - cancels a refusal in flight when a new run starts
  - leaves no arbitrable run when a new one fails to open

Les tests d'intégration conversent avec la boucle : une commande n'est injectée qu'après l'événement qui la rend valide, par un stdin alimenté par une file. Aucun test ne vérifie pydantic : chaque cas échoue contre une régression de nos modèles, de notre dispatch ou de la durée de vie du run courant.

## Edge cases

- **Nouveau run refusé en `tagging_in_progress`** : le run courant n'est pas touché.
- **Nouveau run accepté mais dont l'ouverture échoue** (clé absente, dossier illisible) : l'ancien run est déjà fermé, la session reste sans run courant et `error` nomme `start_tagging`.
- **Geste en vol au moment d'un nouveau run** : annulé à la fermeture de l'ancien, sans événement ; le morceau appartenait à un run que l'interface a quitté.
- **EOF pendant un geste en vol** : le geste est annulé à la fermeture du run courant, l'interface n'étant plus là pour recevoir sa réponse.
- **Geste pendant la phase réseau** : accepté dès que le morceau attend (sub-project 01), la phase continue.
- **`switch_arbitration_source` vers la source déjà affichée** : `arbitration_candidate_unknown`, sans événement.

## Architectural decisions

### Décision : Où vit le run entre sa phase réseau et le run suivant

**Options envisagées :**
- **A. `CurrentRun` gardé par la session** : un objet de `handlers.py` possède le client par un `AsyncExitStack`, fermé au run suivant, au `shutdown` et à l'EOF ; « phase réseau en cours » et « run courant arbitrable » restent deux notions distinctes.
- **B. La tâche de fond garde son `async with` ouvert** : pas de pile, mais la tâche ne se termine plus et `tagging_in_progress` doit distinguer autrement la fin de la phase réseau.
- **C. Un client rouvert par geste** : chaque geste rescanne les caches disque, et la garde des 403 n'est plus partagée avec le run.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- Une ressource, un propriétaire : la tâche du run dit si la phase réseau tourne, le `CurrentRun` dit ce qui est arbitrable.
- Les Features 4 et 5 (`resolve_by_url`, `commit_run`) agiront sur ce même run courant.

### Décision : Un refus nomme la liste qu'il refuse

**Options envisagées :**
- **A. `source` obligatoire sur tout geste** : un refus dont la source n'est plus affichée est rejeté.
- **B. Le refus s'applique à la liste affichée à son arrivée** : l'interface désactive le bouton pendant l'attente.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26, reportée dans le sub-project 01 (`refuse(track_id, source)`).
- Un double clic sur « Aucune correspondance » dont le second arrive après la bascule, Bandcamp répondant vite depuis le cache, refuserait sinon Bandcamp sans que l'utilisateur ait vu sa liste. L'erreur ne se verrait qu'au rapport.

### Décision : Où s'exécutent les gestes

**Options envisagées :**
- **A. En tâche de fond** : la boucle continue de lire stdin pendant un refetch ou un appel Bandcamp.
- **B. Dans la boucle** : plus simple, mais un appel Bandcamp peut durer jusqu'au timeout client de 100 secondes, pendant lesquelles ni un autre geste ni `cancel_run` ne sont lus.

**Choix : A**

**Rationale :**
- Même raison que pour les deux phases longues (ARCHITECTURE.md § Concurrence) : une commande longue ne gèle jamais la lecture de stdin.
- `switch_arbitration_source` reste dans la boucle, sans I/O à attendre.
