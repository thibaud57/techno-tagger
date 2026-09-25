---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "client-techno-scraper"
goal: "Isoler tout le contrat techno-scraper derrière un client asynchrone qui cherche un morceau sur Beatport et Bandcamp et traduit chaque réponse en résultat typé"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-09-19"
---

# Client techno-scraper : recherche, refetch et traduction des réponses

## Scope

Couvre le seul module du sidecar qui connaît l'API techno-scraper : son URL de base, figée en constante, les recherches de morceaux sur Beatport et Bandcamp (première page seulement), le refetch complet du candidat retenu (Beatport par id, Bandcamp par URL), le header `X-API-Key`, le timeout client de 100 s, les bornes de concurrence 3 et 2 d'ADR-017, la nouvelle tentative sur erreur réseau et la traduction de chaque réponse en modèle interne ou en erreur typée qui porte l'`X-Request-ID`. Couvre aussi la mise à jour de la fiche `knowledges/techno-scraper.md`, en retard sur le contrat réel, et l'ajout de la clé `request_id` au jeu de clés logfmt.

Exclut le cache des réponses et le téléchargement des pochettes (sub-project 04), la lecture de la clé dans le trousseau (sub-project 05), l'arrêt du run après trois 403 et le log des échecs avec `run` et `track` (sub-project 06), la résolution d'une URL collée par l'utilisateur et SoundCloud (Feature 4).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui, sous `MockTransport` d'httpx2, vérifie la route, les paramètres et l'en-tête de chaque appel, le mapping des candidats, chaque code de réponse traduit en erreur typée avec le nombre exact de requêtes émises (jamais de nouvelle tentative sur un 403, un 5xx ou un timeout, deux sur une erreur réseau), et la borne de 3 appels Beatport et 2 appels Bandcamp en vol.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/scraper_client.py` (remplace le placeholder : constante d'URL, modèles, erreurs, client)
- **À créer** : `sidecar/tests/helpers/scraper_responses.py` (corps JSON conformes au contrat et fabrique de `MockTransport`)
- **À créer** : `sidecar/tests/unit/test_scraper_client_requests.py` (routes, paramètres, en-tête, mapping)
- **À créer** : `sidecar/tests/unit/test_scraper_client_errors.py` (codes de réponse, nouvelles tentatives, `request_id`)
- **À créer** : `sidecar/tests/unit/test_scraper_client_concurrency.py` (bornes par source)
- **À modifier** : `sidecar/tests/conftest.py` (le TODO du transport httpx2 mocké disparaît)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.scraper_error`, `errors.api_key_rejected`, `errors.source_unavailable`, `errors.track_not_found`, `errors.api_contract_error` : exigés par `test_error_translations.py`)
- **À modifier** : `docs/knowledges/techno-scraper.md` (§ Contrat Track normalisé et table des erreurs, alignés sur techno-scraper 3.1.3)
- **À modifier** : `docs/PRODUCTION.md` (§ Logging, jeu de clés logfmt augmenté de `request_id`)
- **À modifier** : `.claude/rules/python/gestion-erreurs.md` (même jeu de clés)

## Architecture approach

- **Couche anti-corruption dans un seul fichier** (ARCHITECTURE.md § Patterns Utilisés) : URL, routes, codes HTTP et noms de champs ne sortent pas de `scraper_client.py`. Le reste du sidecar ne voit que des modèles internes et des erreurs métier (`.claude/rules/techno-scraper/contrat.md`).
- **Contrat de référence : le dépôt techno-scraper**, `src/technoscraper/shared/schemas.py` à la version 3.1.3 (lu le 2026-09-19). La fiche de connaissance en diverge : `Track` porte un `id`, `catalog_number`, `release_date` et `artwork_url` vivent sous `release`, `duration` n'existe pas, `label` est un profil. Le mapping suit le dépôt, et la fiche est réalignée.
- **URL de base en constante unique** `API_BASE_URL = "https://techno-scraper.empiricmind.fr"` (décision du 2026-09-19) : ni commande `set_api_url` ni champ dans les Settings. C'est le seul endroit du sidecar où elle figure.
- **Un modèle pydantic figé par forme lue, `extra="ignore"`** (ADR-022, `.claude/rules/pydantic/modeles.md`) : `TrackCandidate`, `ReleaseInfo` et `Credit` (le nom d'un artiste, d'un remixeur ou d'un label). Validés à la frontière, ils servent tels quels au scoring et à l'écriture. Un champ ajouté par l'API est ignoré tant que le modèle ne le déclare pas, et une réponse qui ne valide pas devient une `ApiContractError` : la validation protège contre une API qu'aucun lockfile ne fige. Le curseur de pagination n'est pas lu.
- **`Source` en `StrEnum`** (`beatport`, `bandcamp`, `soundcloud`), partagé avec le champ `source` des réponses (`.claude/rules/python/modeles-donnees.md`). La recherche n'accepte que Beatport et Bandcamp, par un `Literal` sur le type (`.claude/rules/python/type-hints.md`).
- **Surface publique** du client `TechnoScraperClient`, context manager asynchrone :
  - `search(source, query)` rend un tuple de candidats de la première page, vide quand la source ne connaît pas le morceau (`.claude/rules/techno-scraper/contrat.md` : `200` + `items: []` n'est pas une erreur). Pas de pagination : un morceau au-delà de la première page n'est pas un candidat plausible (`knowledges/techno-scraper.md` § Pagination).
  - `fetch_beatport_track(track_id)` et `fetch_bandcamp_track(url)` rechargent le candidat retenu, les objets de recherche étant abrégés (la recherche Bandcamp ne rend ni date, ni label, ni ISRC, ni numéro de piste). `fetch_bandcamp_track` resservira au rattrapage par URL de la Feature 4.
- **Requête tronquée à 200 caractères** : `q` est borné à cette longueur par l'API, qui rend `422` au-delà. La contrainte appartient à l'API, donc au client, pas à la construction de la requête.
- **Un `AsyncClient` httpx2 par instance**, qui porte `X-API-Key`, avec `Timeout(connect=10, read=100, write=10, pool=10)` : `read` reste au-dessus du budget de 90 s de l'API, pour recevoir son 504 structuré plutôt qu'un timeout local aveugle (`.claude/rules/httpx2/client.md`, ADR-017). Le transport est injectable au constructeur, ce qui rend `MockTransport` utilisable sans monkeypatch. Le client est fermé en sortie du context manager. Sa durée de vie dans le sidecar est décidée par le pipeline (sub-project 06).
- **Un `asyncio.Semaphore` par source**, 3 pour Beatport et 2 pour Bandcamp, miroir des bornes de l'API (ADR-017, `.claude/rules/python/asyncio.md`). Le refetch passe par le sémaphore de sa source. `Limits` n'est pas utilisé comme borne, il ne compte que des connexions. Le sémaphore est relâché pendant l'attente entre deux tentatives.
- **Toutes les requêtes passent par une méthode privée unique**, qui acquiert le sémaphore, émet la requête, retente et traduit. C'est le point où le sub-project 04 branchera le cache des réponses.
- **Traduction des réponses** (`.claude/rules/techno-scraper/contrat.md`, ARCHITECTURE.md § Robustesse) :

  | Réponse | Erreur | Nouvelle tentative |
  |---|---|---|
  | `403` | `ApiKeyRejectedError` (`api_key_rejected`) | jamais |
  | `502`, `503`, `504`, autre `5xx` | `SourceUnavailableError` (`source_unavailable`) | jamais |
  | erreur réseau sans réponse | `SourceUnavailableError`, motif `network` | 2 fois, après 1 s puis 2 s |
  | timeout local | `SourceUnavailableError`, motif `timeout` | jamais |
  | `404` sur un refetch | `TrackNotFoundError` (`track_not_found`) | jamais |
  | `400`, `422`, réponse qui ne valide pas | `ApiContractError` (`api_contract_error`) | jamais |

  Le 503 a déjà été retenté trois fois côté API (`http_max_retries: 3`, ADR-017), un 504 signale une file saturée qu'un retry allongerait, un 403 est une clé à corriger. Seule l'erreur réseau sans réponse (DNS, connexion refusée ou coupée, délai de connexion dépassé) se retente. L'attente entre deux tentatives est injectable au constructeur (`sleep`, `asyncio.sleep` par défaut) : les tests vérifient les délais de 1 s puis 2 s sans dormir ni patcher `asyncio`.
- **Famille `ScraperError` héritée de `TaggerError`**, `code` stable et `params` en attributs (`.claude/rules/python/gestion-erreurs.md`). `SourceUnavailableError` porte la `source`, le `status` HTTP quand il y en a un, un `reason` (le `code` du corps d'erreur de l'API, `network` ou `timeout`) et le `request_id` lu dans l'en-tête `X-Request-ID`, présent sur toutes les réponses. Ces détails distinguent dans le log et le rapport un `parse_error` d'une source injoignable, alors que les deux donnent le même `failure_reason` (`source_unavailable`).
- **Logs** : le client ne logue que ses nouvelles tentatives, en WARNING avec `source` et `reason`. Un échec définitif est levé sans être logué : le pipeline le logue une seule fois, avec `run`, `track`, `status`, `reason` et `request_id`. La clé `request_id` rejoint le jeu de clés logfmt figé (décision du 2026-09-19), dans PRODUCTION.md § Logging et dans `.claude/rules/python/gestion-erreurs.md`. La clé API n'apparaît dans aucun log ni aucun `params` d'erreur (ADR-012).
- **Sentry** : une `ApiContractError` signale un bug ou une dérive du contrat, elle remonte comme erreur technique. Les erreurs attendues (403, source indisponible, rien trouvé) ne sont pas des événements Sentry (`.claude/rules/sentry/python.md`, ADR-014).

## Acceptance criteria

### Scénario 1 : Recherche Beatport avec résultats
**GIVEN** une API qui rend deux morceaux pour une recherche Beatport
**WHEN** le client cherche « Adam Beyer Your Mind » sur Beatport
**THEN** la requête part sur `/beatport/search` avec `q` et `type=tracks`, et porte l'en-tête `X-API-Key`
**AND** le client rend deux `TrackCandidate` portant titre, `mix_name`, artistes, remixeurs, sortie, label et source

### Scénario 2 : Rien trouvé
**GIVEN** une API qui rend `200` avec une liste vide
**WHEN** le client cherche un morceau sur Bandcamp
**THEN** il rend un tuple vide, sans erreur

### Scénario 3 : Clé refusée
**GIVEN** une API qui rend `403`
**WHEN** le client cherche un morceau
**THEN** une `ApiKeyRejectedError` est levée
**AND** une seule requête a été émise

### Scénario 4 : Source indisponible
**GIVEN** une API qui rend `504` avec le code `request_timeout` et un en-tête `X-Request-ID`
**WHEN** le client cherche un morceau
**THEN** une `SourceUnavailableError` est levée, portant le statut 504, le motif `request_timeout` et le `request_id`
**AND** une seule requête a été émise

### Scénario 5 : Coupure réseau passagère
**GIVEN** une connexion qui échoue deux fois puis aboutit
**WHEN** le client cherche un morceau
**THEN** il rend les candidats de la troisième réponse

### Scénario 6 : Réseau durablement coupé
**GIVEN** une connexion qui échoue à chaque essai
**WHEN** le client cherche un morceau
**THEN** une `SourceUnavailableError` au motif `network` est levée après trois requêtes

### Scénario 7 : Refetch du candidat retenu
**GIVEN** un candidat Beatport d'id `17492013` et un candidat Bandcamp d'URL connue
**WHEN** le client les recharge
**THEN** les requêtes partent sur `/beatport/tracks/17492013` et sur `/bandcamp/tracks` avec le paramètre `url`
**AND** chacune rend un `TrackCandidate` complet

### Scénario 8 : Bornes de concurrence
**GIVEN** une API qui retient chaque requête un court instant avant de répondre, et dix recherches Beatport puis dix Bandcamp lancées en même temps
**WHEN** les recherches sont en cours
**THEN** jamais plus de 3 requêtes Beatport ni plus de 2 requêtes Bandcamp ne sont en vol en même temps

### Scénario 9 : Réponse hors contrat
**GIVEN** une API qui rend `200` avec un morceau sans `title`
**WHEN** le client cherche un morceau
**THEN** une `ApiContractError` est levée

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_scraper_client_requests.py` :
  - sends a beatport search to the search route with the query and the tracks type
  - sends the api key header on every request
  - maps each item to a track candidate with its release, label and credits
  - ignores fields the candidate model does not declare
  - returns an empty tuple when the source finds nothing
  - truncates a query longer than two hundred characters
  - fetches a beatport track by id and a bandcamp track by url
- `sidecar/tests/unit/test_scraper_client_errors.py` :
  - raises api key rejected on a 403 without retrying
  - raises source unavailable on 502, 503 and 504 without retrying (paramétré, `ids` en anglais)
  - carries the status, the api error code and the request id
  - raises source unavailable on a local timeout without retrying
  - retries a network error twice then raises source unavailable
  - returns the result when a network error is followed by a success
  - waits the configured delays between attempts
  - raises track not found on a 404 refetch
  - raises api contract error on a 422 and on a response that does not validate
- `sidecar/tests/unit/test_scraper_client_concurrency.py` :
  - never keeps more than three beatport requests in flight
  - never keeps more than two bandcamp requests in flight

Aucun test ne vérifie httpx2 ni pydantic eux-mêmes : chacun échoue contre une régression de notre route, de notre mapping, de notre table de traduction, de notre politique de nouvelle tentative ou de nos bornes.

## Edge cases

- **Corps d'erreur sans `code`** (403 au format FastAPI `{"detail": ...}`, 5xx d'un proxy en HTML) : le `reason` reste vide, le statut et le `request_id` suffisent au diagnostic.
- **En-tête `X-Request-ID` absent** (erreur réseau, proxy intermédiaire) : `request_id` vide, sans erreur.
- **`id` Beatport absent d'un candidat** : le refetch n'est pas possible. Le candidat reste tel quel et le pipeline décide (sub-project 06), le client ne fabrique pas d'id depuis l'URL.
- **Requête vide** : jamais envoyée, le sub-project 03 classe le morceau en `empty_query` avant tout appel.
- **Plusieurs instances du client dans le même process** : chaque instance a ses propres sémaphores. Le pipeline n'en tient qu'une par run, les bornes de l'API ne protégeant de toute façon pas d'une seconde application lancée en parallèle (`knowledges/techno-scraper.md` § Bornes de concurrence).

## Architectural decisions

### Décision : Nouvelle tentative sur erreur réseau

**Options envisagées :**
- **A. Deux nouvelles tentatives, après 1 s puis 2 s** : absorbe une micro-coupure, trois secondes de plus par morceau au pire quand l'API est tombée.
- **B. Trois nouvelles tentatives, après 1, 2 puis 4 s** : plus tolérant, jusqu'à sept secondes de plus par morceau.
- **C. Aucune** : `source_unavailable` immédiat, le morceau se rejoue au run suivant.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19. ARCHITECTURE.md prévoit un « retry réseau » sans en fixer le nombre.
- Seule l'erreur sans réponse se retente : tout statut reçu décrit déjà l'état de l'API, et le 503 a été retenté trois fois de son côté.

### Décision : Modèle des candidats

**Options envisagées :**
- **A. Un `BaseModel` figé, `extra="ignore"`, utilisé dans tout le sidecar** : validé à la frontière, un seul modèle à maintenir.
- **B. Un `BaseModel` pour la réponse et une dataclass interne** : le reste du sidecar ignore la forme de l'API, au prix de deux modèles et d'un mapping à tenir en phase.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19. `extra="ignore"` rend déjà le sidecar insensible aux ajouts de l'API, qui est l'objet de la couche anti-corruption.
- ADR-022 fixe pydantic sur les réponses de l'API.

### Décision : Refetch du candidat Bandcamp retenu

**Options envisagées :**
- **A. Recharger par `/bandcamp/tracks?url=`** : la Feature 5 écrit tout le socle que Bandcamp expose, au prix d'un appel de plus dans le pool Bandcamp, pour le seul candidat retenu.
- **B. Garder l'objet de recherche** : un appel de moins, mais les morceaux résolus sur Bandcamp perdent date, label, ISRC et numéro de piste.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19, dans la logique d'ADR-011 : écrire tout ce que la source expose.
- La route est la même que celle du rattrapage par URL de la Feature 4, déjà prévue au contrat.
