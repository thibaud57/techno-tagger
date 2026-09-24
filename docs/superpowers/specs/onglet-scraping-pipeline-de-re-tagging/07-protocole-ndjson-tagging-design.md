---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "protocole-ndjson-tagging"
goal: "Exposer le run de re-tagging sur le protocole NDJSON, la boucle restant à l'écoute pendant qu'il tourne"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["02-client-techno-scraper-design.md", "03-requete-et-scoring-design.md", "04-cache-et-pochettes-design.md", "05-cle-api-design.md", "06-pipeline-resolution-design.md"]
date: "2026-09-20"
---

# Protocole NDJSON du run de re-tagging

## Scope

Couvre la commande `start_tagging` et sa charge utile, les événements du run (`run_started`, `progress` en phase `tagging`, `track_resolved`, `arbitration_required`, `run_finished` en phase `network`) avec leurs champs, le handler qui lit la clé, ouvre les caches, construit le client et l'`ArtworkFetcher` puis traduit les événements internes du pipeline, et le passage de la boucle à un dispatch concurrent : le run tourne en tâche de fond pendant que `stdin` continue d'être lu. Couvre aussi la mise à jour de la table du contrat dans ARCHITECTURE.md.

Exclut `resolve_arbitration` et `switch_arbitration_source` (Feature 3), `resolve_by_url` (Feature 4), `commit_run` et `retry_write` (Feature 5), la reprise et le rapport (Feature 6), le miroir TypeScript et l'état côté webview (sub-project 08).

### État livré

À la fin de ce sub-project, on peut : lancer `just dev-sidecar`, envoyer `{"command":"start_tagging","folder":"…"}` à la main et voir défiler `run_started`, les `progress` et les `track_resolved` jusqu'à `run_finished`. En test, un envoi de la même commande sur `stdin`, avec l'API et le CDN mockés, rend la séquence complète, et un `get_version` envoyé pendant le run reçoit sa réponse sans attendre la fin.

## Dependencies

- `06-pipeline-resolution-design.md` (statut: implemented) : `run_tagging`, `TaggingRun`, `TrackRecord`, événements internes, `ApiKeyRejectedRunError`.
- `05-cle-api-design.md` (statut: implemented) : `read_api_key`.
- `04-cache-et-pochettes-design.md` (statut: implemented) : `DiskCache`, `ResponseCache`, `ArtworkFetcher`, `app_data_dir`.
- `02-client-techno-scraper-design.md` (statut: implemented) : `TechnoScraperClient`.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (commande `StartTagging`, événements du run, unions)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`handle_start_tagging`, traduction des événements internes, `tagging_transports`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (boucle concurrente, dispatch de `StartTagging`)
- **À modifier** : `sidecar/src/tagger/matching.py` (`full_title` et `credited_artists` rendues publiques)
- **À modifier** : `sidecar/tests/unit/test_matching_scoring.py` (noms publics)
- **À créer** : `sidecar/tests/unit/test_protocol_tagging.py` (modèles, seuils, traduction des événements)
- **À créer** : `sidecar/tests/integration/test_ndjson_tagging.py` (séquence d'un run, erreurs, commande pendant un run)
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : `start_tagging`, `run_started`, `arbitration_required`, `run_finished`, ligne `shutdown`, phases ; § Robustesse : clé rejetée)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.api_key_missing`, `errors.tagging_in_progress`, exigés par `test_error_translations.py`)

## Architecture approach

- **`protocol.py` reste la seule interface publique du sidecar** (ADR-005, ADR-022) : commandes en `extra="forbid"` et `strict`, événements construits en interne. Les modèles du run traduisent les enregistrements du pipeline, ils ne les exposent pas tels quels : le protocole ne porte que ce que l'interface affiche.
- **Commande `start_tagging`** : `folder` et `thresholds` optionnel. `ThresholdsPayload(floor, ceiling)` valide `0 <= floor <= ceiling <= 100` par un `model_validator`, ce qui produit `malformed_command` en cas de valeurs incohérentes. Absente, la commande laisse le sidecar appliquer ses défauts, seule source des valeurs (ADR-008). La Feature 7 enverra les réglages.
- **Événement `run_started`**, nouveau dans le contrat : `run_id` et la liste des morceaux avec `track_id`, `file_name`, `artist` et `title` lus. Sans lui, l'interface ne pourrait afficher aucune ligne avant la première résolution, alors que DESIGN.md § Couleurs Sémantiques prévoit l'état « rien n'est encore arrivé sur ce morceau ».
- **Événement `track_resolved`** : `track_id`, l'état en trois champs (`state`, `resolution`, `failure_reason`), la `source`, l'artiste et le titre que la source écrira (`after`), les scores et le chemin de la pochette.
  - **`after` est calculé dans le sidecar** : titre suivi de son `mix_name` entre parenthèses quand la source en fournit un et qu'il n'est pas déjà dans le titre, artistes joints par `", "`, remixeurs exclus (ADR-011). Les deux fonctions existent déjà dans `matching.py` pour le scoring : elles deviennent publiques (`full_title`, `credited_artists`) au lieu d'être dupliquées, et la Feature 5 les réutilisera pour écrire les tags.
  - **Les scores partent arrondis** en entiers (`artist`, `title`, `average`), l'affichage étant « A 96 · T 92 » (DESIGN.md § Colonnes). `artist` vaut `null` quand la requête n'avait pas d'artiste.
  - **La pochette part en chemin, jamais en base64** : la webview la lit par `convertFileSrc` depuis le cache (`.claude/rules/tauri/sidecar.md`, DESIGN.md § Conventions de Code).
- **Événement `arbitration_required`** : `track_id`, `source`, `beatport_unavailable` et les candidats en zone grise avec leur artiste, leur titre et leurs scores. La Feature 3 l'étendra avec ce dont sa modale a besoin.
- **Événement `run_finished`** : `phase: "network"`, `run_id` et les compteurs `resolved`, `unresolved` et `awaiting_arbitration`. Le chemin des rapports arrivera avec la Feature 6, le champ `phase` distinguant déjà cette fin de celle de l'écriture (ARCHITECTURE.md § API).
- **Deux axes de phase, deux enums** : `Phase` (`extraction`, `tagging`, `url_recovery`, `write`) qualifie un `progress`, c'est l'étape en cours d'une barre ; `RunPhase` (`network`, `write`) qualifie un `run_finished`, c'est la moitié du run qui vient de se clore. Elles partagent la valeur `write` sans être le même type : mypy refuse de les mélanger, et la Feature 5 posera son `write` sur les deux, l'un pour ses `progress`, l'autre pour sa fin. La distinction est écrite dans ARCHITECTURE.md § API.
- **Erreurs de run**, toutes en `error` avec un `code` que l'interface traduit :
  - `api_key_missing` : aucune clé dans le trousseau, rien ne démarre ;
  - `tagging_folder_unreadable` : le dossier a disparu ou n'en est pas un (sub-project 01) ;
  - `api_key_rejected` : le run s'est arrêté après trois 403 (sub-project 06) ;
  - `tagging_in_progress` : un second `start_tagging` arrive pendant un run.
- **Boucle concurrente** (`__main__.py`) : `run_loop` enveloppe sa lecture dans un `asyncio.TaskGroup`. `start_tagging` y crée une tâche nommée et référencée, puis la boucle repart lire `stdin` : c'est ce qui permettra à la Feature 3 d'envoyer ses décisions pendant que le réseau tourne (ADR-009, « le pipeline ne s'arrête jamais »). Les autres commandes restent traitées l'une après l'autre.
  - un second `start_tagging` pendant qu'une tâche est vivante produit `tagging_in_progress` et ne lance rien ;
  - `shutdown` annule la tâche du run avant de sortir ;
  - l'EOF attend la fin du run : le test d'intégration en dépend, et à la fermeture réelle Tauri arrête le sidecar de toute façon ;
  - une `TaggerError` de la tâche devient un événement `error`, toute autre exception fait tomber le processus par le `TaskGroup`, comme aujourd'hui pour la boucle (PRODUCTION.md § Alertes).
- **Handler** `handle_start_tagging` : lit la clé par `asyncio.to_thread`, ouvre les deux caches sous `app_data_dir() / "cache"`, construit `TechnoScraperClient` et `ArtworkFetcher` en context managers, appelle `run_tagging` avec un rappel qui traduit et émet, puis rend `run_finished`. Les transports viennent d'une fonction `tagging_transports()` qui rend `(None, None)` en production : les tests la remplacent par des `MockTransport`, sans toucher au reste (`.claude/rules/pytest/tests.md`).
- **Traduction des événements** : une fonction par événement interne, `match` fermé par `assert_never` (`.claude/rules/python/pattern-matching.md`). Ajouter un événement au pipeline sans le traduire devient une erreur de typage.
- **Logs** : le handler ne logue rien de plus que le pipeline. Une erreur de run est loguée une seule fois, par la boucle, comme les erreurs métier existantes.

## Acceptance criteria

### Scénario 1 : Séquence complète d'un run
**GIVEN** un dossier de trois morceaux, une clé enregistrée, une API qui valide le premier, met le deuxième en zone grise et ne connaît pas le troisième
**WHEN** `start_tagging` est envoyée sur `stdin`
**THEN** les événements sortent dans cet ordre : `run_started` listant les trois morceaux, puis pour chacun son `track_resolved` ou son `arbitration_required` suivi d'un `progress` en phase `tagging`, et enfin `run_finished` en phase `network` avec un résolu, un non résolu et un en attente

### Scénario 2 : Contenu d'un morceau résolu
**GIVEN** un morceau validé automatiquement sur Beatport, avec pochette
**WHEN** son `track_resolved` est émis
**THEN** il porte `state: "resolved"`, `resolution: "auto"`, `failure_reason: null`, `source: "beatport"`
**AND** `after` donne l'artiste et le titre suivis du nom de mix, les scores sont des entiers et `artwork_path` pointe le fichier en cache

### Scénario 3 : Aucune clé
**GIVEN** un trousseau vide
**WHEN** `start_tagging` est envoyée
**THEN** un seul événement sort, `error` avec le code `api_key_missing`
**AND** aucune requête n'est émise vers l'API

### Scénario 4 : Run déjà en cours
**GIVEN** un run lancé et encore en cours
**WHEN** une seconde `start_tagging` arrive
**THEN** un `error` de code `tagging_in_progress` est émis
**AND** le premier run poursuit sa séquence

### Scénario 5 : Commande servie pendant un run
**GIVEN** un run en cours
**WHEN** `get_version` est envoyée
**THEN** l'événement `version` sort avant `run_finished`

### Scénario 6 : Seuils hors bornes
**GIVEN** une commande dont le plancher vaut 95 et le seuil haut 90
**WHEN** elle est envoyée
**THEN** un `error` de code `malformed_command` est émis, sans valeur de la commande dans ses `params`

### Scénario 7 : Clé refusée pendant le run
**GIVEN** une API qui rend `403` à chaque requête
**WHEN** le run est lancé
**THEN** un `error` de code `api_key_rejected` est émis, et aucun `run_finished`

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_protocol_tagging.py` :
  - accepts a start tagging command without thresholds
  - rejects thresholds out of bounds (paramétré : plancher au-dessus du seuil haut, valeur négative, valeur au-delà de cent)
  - rounds the scores of a resolved track
  - renders the artist and the title a source will write (paramétré : avec mix name, sans mix name, mix name déjà dans le titre)
  - reports no artist score for a query without artist

### Integration
- `sidecar/tests/integration/test_ndjson_tagging.py` :
  - emits the whole sequence of a tagging run
  - describes a resolved track with its source, its scores and its artwork
  - answers a version request while a run is in progress
  - refuses a second tagging run while one is in progress
  - reports a missing api key without calling the api
  - reports a rejected api key and never finishes the run

Aucun test ne vérifie pydantic ni asyncio : chacun échoue contre une régression de notre contrat, de notre traduction ou de notre boucle.

## Edge cases

- **Dossier vide** : `run_started` avec une liste vide, aucun `progress`, `run_finished` à zéro partout.
- **`shutdown` pendant un run** : la tâche est annulée, aucun `run_finished` n'est émis, le processus s'arrête proprement.
- **Morceau en attente d'arbitrage à la fin du run** : il compte dans `awaiting_arbitration` de `run_finished`. La Feature 3 le fera passer en résolu plus tard, la Feature 4 le rattrapera par URL.
- **Pochette absente** : `artwork_path` vaut `null`, le morceau reste résolu.
- **Chemin de pochette hors `appLocalDataDir()`** : impossible, le cache vit sous cette racine, que le scope asset de la webview autorise (sub-project 09).

## Architectural decisions

### Décision : Comment le run tourne pendant que la boucle lit `stdin`

**Options envisagées :**
- **A. Tâche de fond dans un `TaskGroup` au niveau de la boucle** : la boucle reste disponible, une exception inattendue du run fait tomber le processus comme aujourd'hui, et l'EOF attend la fin du run.
- **B. Traitement séquentiel, comme les commandes actuelles** : la boucle serait bloquée pendant tout le run, donc incapable de recevoir les décisions d'arbitrage de la Feature 3, ce qu'ADR-009 exige.
- **C. Un thread dédié au run** : même disponibilité, mais deux boucles d'événements et un accès concurrent à `stdout` à synchroniser.

**Choix : A**

**Rationale :**
- ADR-009 impose que le pipeline continue pendant qu'une modale attend une décision : la boucle doit rester à l'écoute.
- Tout reste dans une seule boucle asyncio, donc une seule écriture sur `stdout` à la fois, sans verrou.

### Décision : Ce que le flux porte quand la clé est rejetée

**Options envisagées :**
- **A. Un `error` de code `api_key_rejected`, sans `run_finished`** : l'erreur est la fin du run, l'interface l'arrête sur cette branche (sub-project 08, `endRun`), et rien ne déclenche le signal de fin de phase.
- **B. `error` puis `run_finished` avec compteurs partiels**, comme ARCHITECTURE.md § Robustesse l'écrivait : la fin est explicite, mais elle ferait jouer le signal sonore et le toast « phase terminée » après une erreur, et la reprise par `resume_run` qu'elle annonce n'existe pas avant la Feature 6.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-20.
- Un run avorté n'a pas de phase terminée : le `run_finished` est réservé à une fin normale, ce qui garde le signal de fin honnête (BRAINSTORM : une fois, à la fin de la phase réseau).
- ARCHITECTURE.md § Robustesse est réécrit dans ce sens, avec le code `api_key_rejected` à la place d'`invalid_api_key`, et la reprise renvoyée à la Feature 6.

### Décision : Où l'artiste et le titre « après » sont calculés

**Options envisagées :**
- **A. Dans le sidecar, en réutilisant les fonctions du matching** rendues publiques : une seule règle de titre, partagée par le scoring, l'affichage et plus tard l'écriture.
- **B. Dans la webview, à partir des champs bruts du candidat** : ce serait une règle métier en TypeScript, interdite par le projet, et un deuxième endroit à corriger quand ADR-011 évolue.

**Choix : A**

**Rationale :**
- CLAUDE.md § Standards : le métier vit dans le sidecar, l'interface affiche ce qu'elle reçoit.
- La règle « titre plus `mix_name` » est déjà écrite pour le scoring : la publier évite une duplication qui divergerait.
