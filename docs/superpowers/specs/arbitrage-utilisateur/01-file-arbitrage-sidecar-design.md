---
feature: "Feature 3 : Arbitrage utilisateur"
subproject: "file-arbitrage-sidecar"
goal: "Tenir dans le sidecar la file des morceaux en zone grise d'un run et les faire avancer sur décision de l'utilisateur : choix d'un candidat, refus qui déclenche Bandcamp, retour à la liste Beatport"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-09-26"
---

# File d'arbitrage dans le sidecar

## Scope

Couvre un run qui reste vivant au-delà de sa phase réseau et d'une interruption, ainsi que les trois gestes d'arbitrage sur un morceau en attente. Choisir un candidat donne `resolved` / `arbitration`, avec refetch et pochette. Refuser Beatport appelle Bandcamp, dont la liste remplace la sienne. Refuser Bandcamp donne `unresolved` / `user_refused`, ou le motif de Bandcamp si sa liste est vide. Revenir à Beatport réaffiche sa liste sans rappel. S'y ajoutent les événements internes de l'arbitrage, ses erreurs métier et la concurrence entre gestes.

Exclut les commandes et l'événement NDJSON ainsi que la conservation du run et de son client dans la session de la boucle (sub-project 02), toute interface (sub-projects 03 et 04), et toute persistance disque des décisions (Feature 6, note de l'ADR-010).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui, sur un run aux API et CDN mockés, tranche un morceau en zone grise par choix, le bascule sur Bandcamp au refus puis le ramène à Beatport, et le passe en `unresolved` / `user_refused` au refus Bandcamp ou avec le motif de Bandcamp quand sa liste est vide, pendant et après la phase réseau comme après une interruption.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À créer** : `sidecar/src/tagger/sources.py` (accès aux sources d'un run : garde des 403, recherche et classement, refetch, pochette)
- **À créer** : `sidecar/src/tagger/arbitration.py` (trois gestes, événements internes de l'arbitrage, erreurs `arbitration_*`)
- **À modifier** : `sidecar/src/tagger/tagging.py` (`LiveRun`, ouverture en deux temps, `PendingArbitration` à deux listes, `_Runner` bâti sur `sources.py`)
- **À créer** : `sidecar/tests/unit/test_arbitration_gestures.py`
- **À créer** : `sidecar/tests/unit/test_tagging_live_run.py`
- **À modifier** : `sidecar/tests/helpers/tagging_api.py` (ouverture d'un run qui rend le `LiveRun` et ses sources, requêtes retenues par une porte `asyncio.Event`)
- **À modifier** : `sidecar/tests/unit/test_tagging_run.py` (import de la garde des 403 et cible du patch Sentry, déplacées dans `sources.py`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (les quatre codes `arbitration_*`, exigés par `test_error_translations.py`)
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence : `sources.py`, `arbitration.py` ; § Chaîne de résolution : le temps 2 vide attend le geste « passer » et garde le motif de Bandcamp, `source_unavailable` compris ; diagramme d'état : la même transition ; § Concurrence : la file vit dans le run vivant, gestes concurrents, un seul geste en vol par morceau)

## Architecture approach

- **Trois unités** (`.claude/rules/python/imports-modules.md`) :
  - `tagging.py` garde les modèles du run et le pipeline, et gagne le `LiveRun` ;
  - `sources.py` reprend tel quel ce que `_Runner` fait des sources : appel sous la garde des 403, recherche puis `classify`, refetch, pochette, logs d'incident. Un seul accès par run, partagé par la phase réseau et par l'arbitrage, donc une seule garde ;
  - `arbitration.py` porte les trois gestes et dépend de `tagging.py` et de `sources.py`, jamais l'inverse.
- **`LiveRun`** : l'état vivant du run, avec ses morceaux par `track_id` dans l'ordre du dossier et la position de chacun pour les logs. Le pipeline y écrit chaque morceau dès qu'il est traité, et non plus en fin de `TaskGroup` : un run interrompu garde ce qu'il a déjà tranché et ce qu'il a mis en attente. `snapshot()` rend le `TaggingRun` gelé existant.
- **Ouverture en deux temps** : d'abord le listing des fichiers et la lecture des identités, qui émettent `RunStarted` et rendent le `LiveRun` ; ensuite la phase réseau. `run_tagging` garde sa signature et enchaîne les deux : `handlers.py` et les tests existants ne changent pas et prouvent le refactor. Le sub-project 02 appellera les deux temps séparément pour garder le `LiveRun` au-delà de la phase réseau.
- **Le client n'appartient pas au run** : `LiveRun`, pipeline et arbitrage reçoivent le client techno-scraper et le fetcher de pochettes en dépendance, comme aujourd'hui (`.claude/rules/httpx2/client.md`). Les garder ouverts après `run_finished`, puis les fermer au run suivant ou au `shutdown`, relève du 02.
- **`PendingArbitration` garde les deux listes** (`.claude/rules/python/modeles-donnees.md`), toujours en dataclass gelée :
  - `source` et `candidates` : la source affichée et sa liste, avec `beatport_unavailable`, les trois champs existants gardant leur sens et leur ordre ;
  - `empty_reason` : le motif d'une liste Bandcamp affichée vide (`no_result`, `below_threshold`, `source_unavailable`) ;
  - `other` : la liste de l'autre source une fois obtenue, mise de côté dans une `SourceList` (source, candidats, motif). Absente tant que Bandcamp n'a pas été appelé, et sans liste Beatport quand Beatport était injoignable ou n'a rien rendu d'exploitable.
  `_arbitration` de `handlers.py` et `test_protocol_tagging.py` ne changent pas.
- **Un geste nomme la liste sur laquelle il porte** (décision du 2026-09-26) : choisir désigne un candidat par `(source, index)`, refuser par `source`. Une source qui n'est plus affichée est rejetée : un double clic sur « Aucune correspondance » arrivé après la bascule refuserait sinon Bandcamp sans que l'utilisateur l'ait vue.
- **Désigner un candidat** : `(source, index)` dans la liste de cette source. Une liste ne change plus une fois obtenue, l'index désigne donc le même candidat tant que le morceau est à arbitrer. La forme sur le fil relève du 02.
- **Transitions**, conformes à ARCHITECTURE.md § Chaîne de résolution et à ADR-009 :
  - **choisir** un candidat de la liste affichée : refetch et pochette, échecs tolérés comme en auto (objet de recherche gardé, pas de pochette), puis `resolved` / `arbitration`, source et scores du candidat. Émet `TrackResolved` ;
  - **refuser** avec Beatport affiché et Bandcamp jamais appelé : recherche Bandcamp puis `classify` avec `allow_auto=False`, la réponse est mémorisée et Bandcamp affiché, même vide. Émet `ArbitrationUpdated`. Bandcamp n'est jamais appelé avant ce refus (ADR-009) ;
  - **refuser** avec Beatport affiché et Bandcamp déjà obtenu : Bandcamp réaffiché, sans appel. Émet `ArbitrationUpdated` ;
  - **refuser** avec Bandcamp affiché et une liste non vide : `unresolved` / `none` / `user_refused`. Émet `TrackResolved` ;
  - **refuser** avec Bandcamp affiché et une liste vide, le geste « passer » de la modale : `unresolved` / `none` avec le motif mémorisé de Bandcamp. Émet `TrackResolved` ;
  - **afficher Beatport** avec Bandcamp affiché : Beatport réaffiché, sans appel. Émet `ArbitrationUpdated`. Sans liste Beatport, le geste est refusé.
- **Bandcamp après un refus ne valide jamais seul** : l'utilisateur est en train de décider, un candidat au-dessus du plafond reste dans la liste (diagramme d'ARCHITECTURE.md, « MODALE temps 2 »). Seuls les candidats au-dessus du plancher y figurent (ADR-009).
- **Échec de Bandcamp après un refus** (`SourceUnavailableError`, `ApiContractError`, `ApiKeyRejectedError`) : liste vide, motif `source_unavailable`. Si ce 403 déclenche la garde partagée, `ApiKeyRejectedRunError` est absorbée pour ce morceau : l'arrêt du run concerne le pipeline, pas un geste d'arbitrage, et un pipeline encore en cours s'arrête au 403 suivant (`.claude/rules/techno-scraper/contrat.md`).
- **Événements de l'arbitrage** : `ArbitrationUpdated` (l'enregistrement du morceau, liste et source affichée à jour) et `TrackResolved`, déjà défini dans `tagging.py`. Ils sortent par un rappel propre à l'arbitrage et non par `RunEvent` : l'ajouter à cette union casserait `to_protocol_event`, fermé par `assert_never` (`.claude/rules/python/type-hints.md`), avant que le 02 ne le traduise.
- **Erreurs métier** (`.claude/rules/python/gestion-erreurs.md`) : famille `ArbitrationError` (`arbitration_error`) qui hérite de `TaggerError`, avec un code stable par feuille, le `track_id` en attribut et aucun message destiné à l'écran :
  - `arbitration_not_pending` : morceau inconnu du run, déjà tranché ou jamais traité ;
  - `arbitration_candidate_unknown` : source qui n'est pas affichée (choix comme refus), index hors de la liste, ou Beatport demandé sans liste Beatport ;
  - `arbitration_busy` : un geste est déjà en vol sur ce morceau.
- **Concurrence** (`.claude/rules/python/asyncio.md`) : des gestes sur des morceaux différents avancent en parallèle, chacun n'attendant que son appel réseau, borné par les sémaphores du client qu'il partage avec le pipeline. Un second geste sur un morceau dont le précédent est en vol est refusé, jamais mis en file : les clics rapides de la modale (DESIGN.md § Layout) lanceraient sinon deux appels Bandcamp. Un geste se tranche dès que son morceau est en attente, pendant la phase réseau comme après.
- **Annulation** : un geste annulé relève `CancelledError` après avoir libéré son morceau et le laisse inchangé. Le 02 annulera les gestes en vol quand un nouveau run remplace l'ancien.
- **Durée de vie** (décision du 2026-09-26) : un morceau en attente reste tranchable après `run_finished` comme après `cancel_run`, jusqu'à ce qu'un nouveau run remplace l'ancien. Rien n'est persisté : un crash ou un nouveau run perd les décisions prises (ADR-010, spec 11 de la Feature 2), risque assumé jusqu'à la Feature 6.
- **Logs** (PRODUCTION.md § Logging) : une ligne INFO par geste en logfmt, `arbitration decided`, `arbitration refused` et `arbitration switched`, avec les seules clés `run`, `track` (position), `source`, `score`, `status` et `reason`. Aucun titre ni chemin, aucun événement Sentry. Le seul effet disque est la pochette du candidat choisi, dans le cache, comme en auto : aucun fichier musical n'est touché.

## Acceptance criteria

### Scénario 1 : Choix d'un candidat Beatport
**GIVEN** un morceau « Your Mind » en attente d'arbitrage avec l'Extended et le Radio Edit de Beatport
**WHEN** l'utilisateur choisit le Radio Edit
**THEN** le morceau est `resolved` / `arbitration`, source Beatport, avec le candidat rechargé et sa pochette en cache
**AND** `TrackResolved` est émis pour ce morceau

### Scénario 2 : Refus de Beatport
**GIVEN** le même morceau en attente sur Beatport
**WHEN** l'utilisateur refuse
**THEN** Bandcamp est interrogé une fois et sa liste est affichée à la place de celle de Beatport
**AND** `ArbitrationUpdated` est émis, sans `TrackResolved`

### Scénario 3 : Pas de validation automatique après un refus
**GIVEN** un morceau refusé sur Beatport dont Bandcamp rend un candidat au-dessus du plafond
**WHEN** la réponse de Bandcamp arrive
**THEN** le candidat figure dans la liste affichée et le morceau reste à arbitrer

### Scénario 4 : Retour à Beatport
**GIVEN** un morceau dont la liste Bandcamp est affichée après un refus
**WHEN** l'utilisateur revient à Beatport, puis refuse de nouveau
**THEN** la liste Beatport est réaffichée, puis la liste Bandcamp
**AND** aucune source n'est rappelée

### Scénario 5 : Refus de Bandcamp
**GIVEN** un morceau dont la liste Bandcamp affichée n'est pas vide
**WHEN** l'utilisateur refuse
**THEN** le morceau est `unresolved` / `none` / `user_refused`

### Scénario 6 : Bandcamp vide
**GIVEN** un morceau refusé sur Beatport que Bandcamp ne connaît pas
**WHEN** la réponse de Bandcamp arrive, puis l'utilisateur passe
**THEN** le morceau reste à arbitrer avec une liste Bandcamp vide jusqu'au geste
**AND** il finit `unresolved` / `none` / `no_result`, et non `user_refused`

### Scénario 7 : Beatport injoignable au départ
**GIVEN** un morceau en attente sur Bandcamp avec `beatport_unavailable`
**WHEN** l'utilisateur refuse
**THEN** le morceau est `unresolved` / `none` / `user_refused`, sans aucun appel
**AND** une demande de retour à Beatport sur ce morceau est refusée en `arbitration_candidate_unknown`

### Scénario 8 : Geste refusé
**GIVEN** un morceau déjà résolu, et un morceau en attente dont un refus attend Bandcamp
**WHEN** un geste arrive sur chacun
**THEN** le premier est refusé en `arbitration_not_pending`, le second en `arbitration_busy`
**AND** Bandcamp n'est appelé qu'une fois

### Scénario 9 : Arbitrage pendant et après la phase réseau
**GIVEN** un run dont un morceau est en attente pendant qu'un autre attend encore sa réponse
**WHEN** l'utilisateur tranche le premier, puis le run se termine ou est interrompu avec d'autres morceaux en attente
**THEN** le premier est résolu sans attendre la fin du run
**AND** les morceaux encore en attente restent tranchables

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_arbitration_gestures.py` :
  - resolves a track by arbitration with the refetched candidate and its artwork
  - calls bandcamp once and shows its list when beatport is refused
  - keeps a bandcamp candidate above the ceiling in the list after a refusal
  - shows the beatport list again without calling any source
  - shows the known bandcamp list again on a second refusal without calling it
  - leaves a track unresolved as user refused when bandcamp is refused
  - keeps the bandcamp reason when an empty list is passed, paramétré sur `no_result`, `below_threshold` et `source_unavailable`
  - refuses a track without calling anything when beatport was unavailable
  - rejects going back to beatport when it was unavailable
  - rejects a gesture on a track that is unknown or already resolved
  - rejects a candidate outside the shown list or from a hidden source
  - rejects a second gesture while the first one is in flight
  - leaves the bandcamp list empty as source unavailable when the key is rejected
  - leaves a track awaiting and unchanged when its gesture is cancelled
  - refuses one track while another refusal waits for bandcamp
  - rejects choosing in an empty bandcamp list
  - rejects showing the list already shown
  - rejects a refusal of a list that is no longer shown
  - calls bandcamp again after a cancelled refusal
- `sidecar/tests/unit/test_tagging_live_run.py` :
  - holds a grey zone track after the network phase
  - keeps the tracks already processed when the run is cancelled
  - resolves an awaiting track while another one is still in flight
  - answers an awaiting track after the run is cancelled

`test_tagging_outcomes.py` reste inchangé et `test_tagging_run.py` ne change que ses imports : tous deux prouvent que le refactor du pipeline ne change aucune issue. `test_error_translations.py` couvre les quatre nouveaux codes. Aucun test ne vérifie httpx2 ni rapidfuzz : l'API et le CDN sont mockés, et chaque cas échoue contre une régression de nos transitions, de notre mémoire des listes ou de notre garde des gestes.

## Edge cases

- **Beatport vide, Bandcamp en zone grise** (pipeline) : pas de liste Beatport, le retour à Beatport est refusé et un refus donne `user_refused`, comme une panne Beatport.
- **Retour à Beatport après une liste Bandcamp vide** : possible ; un nouveau refus réaffiche la liste vide sans rappel, et le geste « passer » garde le motif mémorisé.
- **Refus pendant la phase réseau** : l'appel Bandcamp attend son tour sur le sémaphore Bandcamp du client, partagé avec le pipeline.
- **Refetch ou pochette en échec au choix** : le morceau est résolu avec l'objet de recherche, sans pochette, avec un WARNING, comme en auto.
- **Morceau jamais traité d'un run interrompu** : aucun geste possible, `arbitration_not_pending`.
- **Garde des 403 déjà déclenchée par le pipeline** : un refus qui reçoit un 403 donne une liste vide `source_unavailable`, sans lever.

## Architectural decisions

### Décision : Organisation du code de l'arbitrage

**Options envisagées :**
- **A. Tout dans `tagging.py`** : les gestes ajoutés à `_Runner`, réutilisation directe de ses méthodes, mais un fichier d'environ 650 lignes qui mêle pipeline et arbitrage.
- **B. `arbitration.py` sur un accès aux sources partagé** : `sources.py` extrait de `_Runner`, `LiveRun` tenu au fil de l'eau, chaque unité testable seule, au prix d'un refactor du pipeline.
- **C. Une file `asyncio.Queue` et un `Future` par morceau en zone grise** : le pipeline attendrait la décision.

**Choix : B**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- C retiendrait le `TaskGroup` jusqu'à la dernière décision, donc `run_finished` et le signal de fin de phase réseau attendraient l'humain, contre ADR-009 (« le pipeline ne s'arrête jamais »).
- Le refactor de B est couvert par les tests existants du pipeline, qui ne changent pas.
- Le run vivant sert aussi les Features 4 et 5 (`resolve_by_url`, `commit_run`), qui agissent sur le même run après sa phase réseau.

### Décision : Sort des arbitrages en attente à l'interruption et au run suivant

**Options envisagées :**
- **A. Tranchables jusqu'au run suivant** : l'interruption les laisse en file, seul un nouveau `start_tagging` les jette avec l'ancien run.
- **B. Jetés dès l'interruption** : `cancel_run` vide la file.
- **C. Bloquants** : `start_tagging` refusé tant que des arbitrages attendent.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- Interrompre sert à cesser de consommer le quota, pas à renoncer à ce que le run a déjà trouvé : un refus reste un geste explicite qui coûte un appel.
- Même règle que la spec 11 de la Feature 2 pour les décisions déjà prises : perdues avec le run, au moment où un autre le remplace.

### Décision : Morceau dont Bandcamp ne rend rien après un refus

**Options envisagées :**
- **A. En file jusqu'au geste, motif de Bandcamp** : le morceau reste à arbitrer avec une liste vide ; « passer » le met en `unresolved` avec `no_result`, `below_threshold` ou `source_unavailable`.
- **B. Non résolu dès la réponse** : le sidecar tranche aussitôt et l'interface tient seule le message ouvert.
- **C. En file jusqu'au geste, `user_refused`** : le refus de Beatport est tenu pour la cause.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-26.
- BRAINSTORM veut un message dans la modale et une seule action pour passer au suivant : le morceau part en non résolu au geste, pas avant.
- Le motif de Bandcamp dit la correction à apporter dans le rapport, `user_refused` la masquerait (ARCHITECTURE.md § Chaîne de résolution : « la correction à apporter n'étant pas la même selon le motif »).
