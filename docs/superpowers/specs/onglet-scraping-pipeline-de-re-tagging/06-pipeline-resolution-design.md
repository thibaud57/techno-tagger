---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "pipeline-resolution"
goal: "Résoudre tous les morceaux d'un dossier en parallèle borné, de la lecture des tags au candidat retenu, sans jamais bloquer sur une décision humaine"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-lecture-tags-fichiers-design.md", "02-client-techno-scraper-design.md", "03-requete-et-scoring-design.md", "04-cache-et-pochettes-design.md", "05-cle-api-design.md"]
date: "2026-09-19"
---

# Pipeline de résolution d'un run de re-tagging

## Scope

Couvre l'orchestration asynchrone d'un run sur un dossier : énumération des fichiers, lecture des tags, construction de la requête, interrogation de Beatport, classement, repli sur Bandcamp sur un résultat vide ou une panne Beatport, mise en attente des zones grises, `unresolved` et son `failure_reason`, refetch et pochette du candidat retenu, arrêt du run après trois 403 consécutifs, progression et état complet du run en mémoire. Le pipeline émet ses événements par un rappel, sans rien connaître du protocole NDJSON.

Exclut la décision d'arbitrage et l'appel Bandcamp déclenché par un refus (Feature 3), le rattrapage par URL (Feature 4), toute écriture sur les fichiers musicaux (Feature 5), la persistance du plan de run et le rapport (Feature 6), l'exposition sur le protocole et la construction du client (sub-project 07).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui lance un run sur des fichiers audio de test, avec l'API et le CDN mockés, et obtient chaque issue : auto Beatport, auto Bandcamp, zone grise en attente, Beatport en panne suivi d'une zone grise Bandcamp, `no_result`, `below_threshold`, `empty_query`, `source_unavailable`, puis l'arrêt du run au troisième 403 consécutif.

## Dependencies

- `01-lecture-tags-fichiers-design.md` (statut: draft) : `list_audio_files`, `read_identity`, `TagsUnreadableError`, `TaggingFolderUnreadableError`, et le helper des fichiers audio de test.
- `02-client-techno-scraper-design.md` (statut: draft) : `TechnoScraperClient`, `TrackCandidate`, `Source`, `ApiKeyRejectedError`, `SourceUnavailableError`, `TrackNotFoundError`, `ApiContractError`, helpers de réponses.
- `03-requete-et-scoring-design.md` (statut: draft) : `build_query`, `classify`, `MatchingThresholds`, `Outcome`, `ScoredCandidate`.
- `04-cache-et-pochettes-design.md` (statut: draft) : `ArtworkFetcher`, `ArtworkUnavailableError`.
- `05-cle-api-design.md` (statut: draft) : la clé que le handler du sub-project 07 lira pour construire le client.

## Files touched

- **À créer** : `sidecar/src/tagger/tagging.py` (modèles du run, événements internes, pipeline)
- **À créer** : `sidecar/tests/helpers/tagging_api.py` (API et CDN mockés, routés par source et par requête)
- **À créer** : `sidecar/tests/unit/test_tagging_outcomes.py` (issues d'un morceau)
- **À créer** : `sidecar/tests/unit/test_tagging_run.py` (événements, progression, garde des 403, incidents)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Chaîne de résolution : prose et diagramme, Beatport injoignable vers Bandcamp sans auto ; § Flux d'un run : la décision n'est plus écrite dans un plan JSON ; arborescence : `tagging.py`)
- **À modifier** : `docs/adrs/009-enchainement-sources-et-arbitrage.md` (note complémentaire sur la panne Beatport)
- **À modifier** : `docs/adrs/010-ecriture-batch-et-plan-de-run.md` (note complémentaire : l'état du run reste en mémoire jusqu'à la Feature 6)
- **À modifier** : `sidecar/src/tagger/scraper_client.py` (`search` demande `limit=10`, sous précondition de déploiement de la gateway, cf. § À trancher)
- **À modifier** : `sidecar/tests/unit/test_scraper_client_requests.py` (paramètres envoyés aux deux routes de recherche)

## Architecture approach

- **Module `tagger/tagging.py`**, pendant d'`extraction.py` pour le use-case 2 : il orchestre `files`, `matching`, `scraper_client` et `cache` sans en réimplémenter aucun, et ignore tout du protocole (`.claude/rules/python/imports-modules.md`).
- **Point d'entrée** : `run_tagging(folder, *, client, artworks, thresholds, on_event) -> TaggingRun`. Le client et le fetcher de pochettes sont injectés : le handler du sub-project 07 les construit, avec la clé et les caches, ce qui rend le pipeline testable sous `MockTransport`. Un dossier illisible lève `TaggingFolderUnreadableError` avant tout événement.
- **Identifiant de morceau** : le chemin relatif au dossier, en séparateurs `/` (décision du 2026-09-19). Il reste stable quand des fichiers s'ajoutent, ce dont la reprise de la Feature 6 a besoin. Il ne quitte jamais la machine.
- **Une tâche par morceau dans un `asyncio.TaskGroup`**, nommée et référencée (`.claude/rules/python/asyncio.md`). La concurrence réseau est bornée par les sémaphores du client (3 Beatport, 2 Bandcamp) et par celui des pochettes (6). La lecture des tags passe par `asyncio.to_thread`. Le pipeline ne s'arrête jamais sur un morceau : seule la garde des 403 arrête le run.
- **Chemin d'un morceau**, conforme à ARCHITECTURE.md § Chaîne de résolution :
  1. identité lue par `read_identity`. `TagsUnreadableError` est loguée en WARNING avec `run`, `track` et `reason`, et le morceau continue avec une identité vide, donc une requête tirée du nom de fichier (décision du sub-project 01) ;
  2. `build_query`. Sans requête, `unresolved` / `none` / `empty_query`, sans appel réseau (ARCHITECTURE.md § Requête vide après nettoyage) ;
  3. recherche Beatport, puis `classify` :
     - `AUTO` : refetch, pochette, `resolved` / `auto` ;
     - `GREY_ZONE` : le morceau passe en attente d'arbitrage avec les candidats en jeu ;
     - `EMPTY` : Bandcamp ;
     - `SourceUnavailableError` ou `ApiContractError` : Bandcamp, **sans validation automatique possible** ;
  4. recherche Bandcamp, puis `classify` :
     - `AUTO` : refetch, pochette, `resolved` / `auto`, sauf si Beatport était injoignable, auquel cas le candidat part en zone grise ;
     - `GREY_ZONE` : attente d'arbitrage ;
     - `EMPTY` : `unresolved` / `none`, avec `below_threshold` si l'une des deux sources a rendu au moins un candidat, `no_result` sinon ;
     - `SourceUnavailableError` ou `ApiContractError` : `unresolved` / `none` / `source_unavailable`.
- **Beatport injoignable** (décision du 2026-09-19, écart à ADR-009) : une fois les nouvelles tentatives du client épuisées, Bandcamp est interrogé, mais tout ce qu'il trouve part en zone grise, jamais en auto, avec le drapeau `beatport_unavailable` dans l'attente d'arbitrage. L'utilisateur confirme en sachant que la source la plus riche n'a pas répondu, plutôt que de voir écrire en silence les métadonnées plus pauvres de Bandcamp. ADR-009 n'appelle Bandcamp que sur un vide ou un refus : une panne n'est ni l'un ni l'autre, et l'appel n'a rien de spéculatif puisque Beatport n'a rien pu dire. La note est ajoutée à l'ADR et au diagramme d'ARCHITECTURE.md.
- **Attente d'arbitrage** : un morceau en zone grise a un `state` à `None`, qu'aucun événement `track_resolved` n'accompagne, et une `PendingArbitration` (source, candidats en jeu triés, `beatport_unavailable`). Le pipeline émet `ArbitrationRequired` et passe au morceau suivant : la décision, et l'appel Bandcamp sur refus, relèvent de la Feature 3 (ADR-009 « le pipeline ne s'arrête jamais »).
- **Refetch et pochette du candidat retenu** : refetch par id sur Beatport, par URL sur Bandcamp (sub-project 02). Un id ou une URL absent, un `TrackNotFoundError`, une source indisponible ou une réponse hors contrat gardent l'objet de recherche, avec un WARNING. La pochette `release.artwork_url` est téléchargée par l'`ArtworkFetcher`. Une `ArtworkUnavailableError` est loguée en WARNING et le morceau reste résolu sans pochette (`.claude/rules/httpx2/client.md`).
- **Garde des 403** : un compteur de 403 consécutifs, partagé par les tâches, est remis à zéro par toute réponse de l'API qui n'est pas un 403. Au troisième, la tâche lève `ApiKeyRejectedRunError` (`api_key_rejected`, sans `params`), le `TaskGroup` annule les autres, et `run_tagging` relève cette erreur hors de l'`ExceptionGroup` (`except*`, `.claude/rules/python/gestion-erreurs.md`). Les morceaux déjà traités gardent leur état. Un 403 isolé, suivi d'autres réponses, donne `unresolved` / `source_unavailable` pour son morceau. La clé n'est jamais nommée par sa valeur (ARCHITECTURE.md § Clé API invalide ou révoquée).
- **Réponse hors contrat** : `ApiContractError` est un bug ou une dérive d'API, pas un aléa. Elle est loguée en ERROR et remontée à Sentry par `sentry_sdk.capture_exception`, la `LoggingIntegration` étant fermée (`observability.py`). Le morceau suit le chemin d'une source indisponible (`.claude/rules/sentry/python.md`).
- **État du run en mémoire** (`.claude/rules/python/modeles-donnees.md`) :
  - `TaggingRun` : `run_id`, dossier, et un `TrackRecord` par `track_id`, dans l'ordre de `list_audio_files` ;
  - `TrackRecord` : `track_id`, chemin, nom de fichier, identité lue, requête, `state`, `resolution`, `failure_reason`, source, candidat retenu, scores du candidat retenu, chemin de la pochette, attente d'arbitrage ;
  - `TrackState` (`resolved`, `unresolved`), `Resolution` (`auto`, `arbitration`, `url`, `none`) et `FailureReason` (`empty_query`, `no_result`, `below_threshold`, `user_refused`, `source_unavailable`) en `StrEnum` avec `@verify(UNIQUE)`, valeurs d'ARCHITECTURE.md § API. La Feature 5 y ajoutera `written`, `write_error` et les motifs d'écriture. Le plan de run de la Feature 6 sérialisera ces modèles, ce qui les garde en dataclasses gelées aux champs simples.
- **Événements internes**, passés à `on_event` dans l'ordre où ils surviennent. Le sub-project 07 les traduit en NDJSON, ce module n'émet aucune ligne :
  - `RunStarted` : `run_id` et, pour chaque morceau, `track_id`, nom de fichier et identité lue. Toutes les lignes de la liste peuvent s'afficher dès le départ (DESIGN.md : « Neutre, il attend son tour ») ;
  - `TrackResolved` : l'enregistrement d'un morceau résolu ou non résolu ;
  - `ArbitrationRequired` : l'enregistrement d'un morceau mis en attente ;
  - `RunProgress` : traités sur total. Un morceau compte dès qu'il est résolu, non résolu ou en attente d'arbitrage.
  La fin du run est le retour de `run_tagging` : le 07 en tire `run_finished` en phase `network`, qui déclenche le signal sonore.
- **Logs** (PRODUCTION.md § Logging) : une ligne INFO par décision de matching, avec `run`, `track` (position dans le run), `source`, `score` et `status`. Le motif d'un échec va dans `reason`, et une erreur n'est loguée qu'une fois, là où elle est traitée. Aucun titre de morceau ne part vers Sentry.

## Acceptance criteria

### Scénario 1 : Validation automatique sur Beatport
**GIVEN** un fichier tagué « Adam Beyer » / « Your Mind » et une API Beatport qui rend l'Original Mix
**WHEN** le run est lancé
**THEN** le morceau est `resolved` / `auto`, source Beatport, avec le candidat rechargé et sa pochette en cache
**AND** Bandcamp n'est jamais interrogé

### Scénario 2 : Validation automatique sur Bandcamp
**GIVEN** un fichier dont la recherche Beatport est vide et que Bandcamp trouve
**WHEN** le run est lancé
**THEN** le morceau est `resolved` / `auto`, source Bandcamp

### Scénario 3 : Zone grise
**GIVEN** un fichier « Your Mind » dont Beatport ne propose que l'Extended et le Radio Edit
**WHEN** le run est lancé
**THEN** le morceau a un `state` vide et une attente d'arbitrage Beatport portant les deux candidats
**AND** `ArbitrationRequired` est émis, aucun `TrackResolved` pour ce morceau

### Scénario 4 : Beatport en panne
**GIVEN** une API qui rend `503` sur Beatport et un candidat parfait sur Bandcamp
**WHEN** le run est lancé
**THEN** le morceau est en attente d'arbitrage Bandcamp, avec `beatport_unavailable`
**AND** il n'est pas validé automatiquement

### Scénario 5 : Rien trouvé
**GIVEN** un fichier que ni Beatport ni Bandcamp ne connaissent
**WHEN** le run est lancé
**THEN** le morceau est `unresolved` / `none` / `no_result`

### Scénario 6 : Rien au-dessus du plancher
**GIVEN** un fichier dont les deux sources ne rendent que des candidats d'autres artistes
**WHEN** le run est lancé
**THEN** le morceau est `unresolved` / `none` / `below_threshold`

### Scénario 7 : Rien à demander
**GIVEN** un fichier sans tags nommé `01 - [FREE DL].mp3`
**WHEN** le run est lancé
**THEN** le morceau est `unresolved` / `none` / `empty_query`
**AND** aucune requête n'est émise pour lui

### Scénario 8 : Deux sources en panne
**GIVEN** une API qui rend `503` sur Beatport et sur Bandcamp
**WHEN** le run est lancé
**THEN** le morceau est `unresolved` / `none` / `source_unavailable`

### Scénario 9 : Clé refusée
**GIVEN** une API qui rend `403` à toute requête, et cinq fichiers
**WHEN** le run est lancé
**THEN** `run_tagging` lève `ApiKeyRejectedRunError` après trois 403
**AND** aucun morceau n'est marqué `resolved`

### Scénario 10 : Incidents qui ne font pas échouer le morceau
**GIVEN** un fichier aux tags illisibles mais au nom exploitable, une pochette que le CDN refuse et un refetch qui rend `503`
**WHEN** le run est lancé
**THEN** le morceau est résolu depuis son nom de fichier, sans pochette, avec le candidat de la recherche

### Scénario 11 : Événements du run
**GIVEN** trois fichiers
**WHEN** le run est lancé
**THEN** `RunStarted` est émis en premier et liste les trois morceaux avec leur identité lue
**AND** le dernier `RunProgress` vaut trois sur trois

### Scénario 12 : Taille de page de la recherche
**GIVEN** une gateway déployée qui accepte `limit` (cf. § À trancher, dépendance d'ordre)
**WHEN** le pipeline cherche un morceau sur Beatport ou sur Bandcamp
**THEN** la requête porte `limit=10`

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_scraper_client_requests.py` :
  - sends a search to its source route with the query type and page size (test existant, élargi)
- `sidecar/tests/unit/test_tagging_outcomes.py` :
  - validates automatically on beatport without calling bandcamp
  - validates automatically on bandcamp after an empty beatport search
  - puts a grey zone track on hold without resolving it
  - sends bandcamp candidates to arbitration when beatport is unavailable
  - marks a track unknown to both sources as no result
  - marks a track whose candidates are all below the floor as below threshold
  - marks a file name reduced to noise as empty query without any request
  - marks a track as source unavailable when both sources fail
  - keeps the search candidate when the refetch fails
  - resolves a track without artwork when the cdn refuses it
  - falls back on the file name when the tags are unreadable
- `sidecar/tests/unit/test_tagging_run.py` :
  - emits run started first with every track and its identity
  - counts a track as processed once resolved, unresolved or on hold
  - stops the run after three consecutive rejections of the key
  - resets the rejection count on any other answer
  - raises a tagging folder error for an unreadable folder before any event
  - reports an api contract error to sentry

Aucun test ne vérifie httpx2, rapidfuzz ni mutagen : l'API et le CDN sont mockés, et chaque cas échoue contre une régression de notre enchaînement des sources, de notre traduction en état ou de notre garde des 403.

## Edge cases

- **Dossier sans fichier audio** : `RunStarted` avec une liste vide, aucune progression, retour immédiat.
- **Candidat sans id Beatport ni URL Bandcamp** : pas de refetch, l'objet de recherche est gardé.
- **Candidat sans `release.artwork_url`** : aucune pochette demandée, aucun WARNING.
- **403 sur le refetch d'un candidat retenu** : compte dans la garde comme toute réponse, et le morceau garde l'objet de recherche tant que le run n'est pas arrêté.
- **Même fichier audio à deux chemins** (lien, copie) : deux morceaux distincts, chaque `track_id` étant un chemin.
- **Annulation du run** (fermeture de l'application) : `CancelledError` relevée après nettoyage, jamais avalée. L'état en mémoire est perdu, sa persistance relève de la Feature 6.

## À trancher pendant ce sub-project

- **Taille de page de la recherche Beatport, à choisir ici et non avant.** `/beatport/search` rend aujourd'hui 100 résultats par page, valeur en dur dans techno-scraper (`providers/beatport/client.py`, `_PER_PAGE`), sans paramètre pour en demander moins : mesuré le 2026-09-20, `per_page`, `limit`, `page_size` et `size` sortent tous en `422`, les modèles de paramètres étant en `extra="forbid"`. Beatport lui-même rend 25 par défaut et plafonne à 100.
  - Coût mesuré le 2026-09-20 : 77 Ko par recherche, soit environ 38 Mo descendants pour une playlist de 500 morceaux, transférés deux fois puisque le VPS les reçoit puis les relaie.
  - Aucun effet sur le risque de blocage : les sources limitent la concurrence et non le débit (`core/limits.py` de techno-scraper borne Bandcamp à 2 et Beatport à 3), et une page plus courte ne change pas le nombre de requêtes, qui reste d'une par morceau et par source.
  - Ne concerne que Beatport : Bandcamp ne pagine pas et rend ce qu'il trouve.
  - **Décision du propriétaire le 2026-09-20** : exposer `per_page` sur la route, avec le défaut de la source (25) et ses bornes (1 à 100), plutôt que de baisser la constante. La gateway est bas niveau et n'a pas à trancher pour ses consommateurs, qui n'ont pas les mêmes besoins : techno-dl ratisse, techno-tagger traque un morceau précis. C'est un changement dans le dépôt techno-scraper, côté modèle de `CatalogSearchQuery` et argument de `fetch_search`.
  - **Dimensionner ici et pas plus tôt** : les rangs relevés le 2026-09-20 (candidat retenu aux rangs 1, 1, 1, 1 et 3 sur dix recherches) ont été mesurés avec le scoring du sub-project 03 avant correction de ses deux défauts. Remesurer une fois le scoring juste, sur des tags réels et non forgés, avant de fixer la valeur.
  - **Piège à documenter sur le paramètre** : le curseur encode un numéro de page et non un offset (`_page_from_cursor`), donc changer `per_page` en cours de parcours saute ou répète des résultats.
  - **Ce qui a été livré diverge de cette décision sur trois points**, vérifié dans le dépôt techno-scraper (releasé en `3.2.0`, déployée le 2026-09-22) : le paramètre s'appelle `limit`, pas `per_page` (`shared/queries.py::PageSizeQuery`) ; ce n'est pas une borne libre de 1 à 100 mais une énumération fermée `5/10/25/50/100`, défaut `25` (`shared/queries.py::PageSize`, un `IntEnum` ; une valeur hors énumération rend `422`) ; enfin le piège documenté ci-dessus est désormais gardé par l'API elle-même plutôt que laissé au consommateur, qui rend `400 cursor_limit_mismatch` au lieu de sauter ou répéter des résultats en silence, le curseur portant `limit` et une empreinte de la requête (`core/pagination.py`, [ADR-009](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md) note du 2026-09-21). Le paramètre s'applique aux six routes rendant `Page[T]` de l'API, pas à `/beatport/search` seule.
  - **Décision du propriétaire le 2026-09-21** : la taille de page retenue pour la recherche du tagger est `10`, valeur légale de l'énumération, en dessous du défaut de la source (`25`).
  - **Vérifié le 2026-09-22 à travers la gateway** (même branche) : la tête de liste Beatport ne dépend pas de la taille de page, top 10 identique entre `limit=10` et `limit=100` sur deux recherches. Un candidat relevé aux rangs 1 à 3 sur une page de 100 reste donc dans la page de 10. Côté Bandcamp la découpe est locale : la page de 10 est par construction la tête des 50.
  - **Dépendance d'ordre avant implémentation** : le contrat est porté par la `3.2.0` de techno-scraper, déployée en production le 2026-09-22. Une prod antérieure (`3.1.4`, Parameter Models en `extra="forbid"`) rend `422` sur tout `limit`, donc un run entier sans candidat : la Task 4 du plan garde sa vérification par `curl` avant d'écrire une ligne.

## Architectural decisions

### Décision : Beatport injoignable après les nouvelles tentatives

**Options envisagées :**
- **A. `unresolved` / `source_unavailable` sans interroger Bandcamp** : fidèle à la lettre d'ADR-009, mais un morceau connu reste en échec jusqu'au run suivant.
- **B. Bandcamp, validation automatique possible** : la panne compte comme un vide, le plus de morceaux résolus sans intervention, avec des métadonnées plus pauvres écrites en silence.
- **C. Bandcamp, sans validation automatique** : tout candidat trouvé part en zone grise, l'utilisateur confirme en sachant que Beatport était en panne.

**Choix : C**

**Rationale :**
- Décision du propriétaire le 2026-09-19.
- Une panne Beatport touche en général tout le run : A laisserait tout le run en échec, B l'écrirait entièrement avec la source la moins riche sans le dire.
- Les nouvelles tentatives restent celles du client, communes aux deux sources (sub-project 02).

### Décision : Où vit l'état du run

**Options envisagées :**
- **A. En mémoire, dans `TaggingRun`, sérialisable plus tard** : le pipeline livre ses modèles gelés et rien d'autre ; la Feature 6 les écrira dans le plan JSON d'ADR-010 sans les changer.
- **B. Écriture au fil de l'eau dans le plan JSON dès maintenant** : fidèle à la lettre d'ADR-010 et au flux d'ARCHITECTURE.md, mais impose de concevoir le format, sa purge et son versionnement (ADR-018) avant de savoir ce que le rapport et la reprise en attendent.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19 : le plan de run est délégué à la Feature 6, qui porte la reprise et le rapport, ses deux seuls lecteurs.
- ADR-010 reste entier : les fichiers musicaux ne sont touchés qu'après la confirmation globale, ce que la Feature 2 respecte en n'écrivant rien. Seul le moment où le plan touche le disque recule ; ADR-018 s'applique à ce moment-là.
- Les modèles sont déjà des dataclasses gelées aux champs simples pour cette raison. La note est ajoutée à ADR-010, et l'étape « écriture de la décision dans le plan JSON » du flux d'ARCHITECTURE.md est marquée comme différée.

### Décision : Identifiant d'un morceau

**Options envisagées :**
- **A. Chemin relatif au dossier** : stable quand le dossier change, lisible dans le plan de run.
- **B. Index dans la liste** : compact, mais décalé dès qu'un fichier s'ajoute entre deux sessions.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19.
- La reprise d'un run interrompu (Feature 6) doit retrouver chaque morceau après un ajout de fichier au dossier.
