---
feature: "Feature 4 — Rattrapage par URL manuelle"
subproject: "client-resolution-url"
goal: "Donner au client techno-scraper la capacité de transformer une URL Beatport, Bandcamp ou SoundCloud collée par l'utilisateur en candidat normalisé"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: []
date: "2026-10-02"
---

# Client techno-scraper : résolution d'une URL de morceau

## Scope

Couvre, dans `scraper_client.py`, la reconnaissance de la source d'une URL collée, sa normalisation, le refus sans appel réseau de toute URL qui ne désigne pas un morceau d'une des trois sources, puis l'appel de la route qui rend ce morceau : `/beatport/tracks/{id}` après extraction de l'id, `/bandcamp/tracks?url=` et `/soundcloud/resolve?url=`, dont la réponse profil est écartée. Couvre aussi la borne de concurrence SoundCloud et sa trace dans les docs.

Exclut le geste sur le run vivant, la pochette et le décompte de phase (sub-project 02), la commande NDJSON (sub-project 03) et toute interface (sub-projects 04 et 05).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui, sous `MockTransport` d'httpx2, montre qu'une URL de morceau de chaque source part sur la bonne route avec une URL normalisée et rend un `TrackCandidate`, qu'une URL hors des formes acceptées ou résolue en profil est refusée en `unsupported_url`, sans requête dans le premier cas, et que jamais plus de 5 requêtes SoundCloud ne sont en vol.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/scraper_client.py` (parseur privé des URL de morceau, `fetch_by_url`, `UnsupportedTrackUrlError`, validation de la réponse de `/soundcloud/resolve`, sémaphore SoundCloud, `_request`/`_get`/`_translate` typés sur `Source`)
- **À créer** : `sidecar/tests/unit/test_scraper_client_urls.py` (reconnaissance, normalisation, routes, refus)
- **À modifier** : `sidecar/tests/unit/test_scraper_client_concurrency.py` (borne SoundCloud)
- **À modifier** : `sidecar/tests/helpers/scraper_responses.py` (corps `Track` SoundCloud et enveloppe profil de `/soundcloud/resolve`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.unsupported_url`, exigé par `test_error_translations.py`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Concurrence : borne SoundCloud de 5)
- **À modifier** : `docs/adrs/017-taille-pool-concurrence.md` (précision datée : borne SoundCloud, en miroir de l'API)
- **À modifier** : `docs/knowledges/techno-scraper.md` (§ Bornes de concurrence : SoundCloud 5 ; § Routes consommées : formes d'URL que SoundCloud rejette)
- **À modifier** : `.claude/rules/techno-scraper/contrat.md` (normaliser une URL collée avant l'appel)

## Architecture approach

- **Couche anti-corruption** (ARCHITECTURE.md § Patterns Utilisés, `.claude/rules/techno-scraper/contrat.md`) : les formes d'URL acceptées recopient les contraintes des routes de l'API et de SoundCloud. Elles appartiennent au contrat et vivent dans `scraper_client.py` : un changement côté API ne touche que ce fichier.
- **La reconnaissance d'URL vit dans le sidecar seul** (décision du propriétaire, 2026-09-29) : c'est la règle qui décide des sources acceptées, SoundCloud n'entrant que par là (ADR-009). L'interface ne garde aucune copie des hôtes. Le sub-project 05 en tire l'écart à la maquette et à DESIGN.md (« validation de l'hôte avant envoi »).
- **Un seul point d'entrée public** `fetch_by_url(url) -> TrackCandidate`. Un parseur privé et pur rend la source et la cible de la requête, `fetch_by_url` appelle ensuite `fetch_beatport_track`, `fetch_bandcamp_track` ou la résolution SoundCloud. Le sub-project 02 n'a pas à savoir quelle source exige quoi.
- **Normalisation avant contrôle** : espaces de bord retirés, découpage par `urllib.parse.urlsplit`, hôte en minuscules, query, fragment et `/` final retirés, schéma `http` réécrit en `https`. Motifs de chemin compilés une fois, ancrés, groupes nommés (`.claude/rules/python/stdlib-donnees.md`) :

  | Source | Hôtes acceptés | Chemin | Requête émise |
  |---|---|---|---|
  | Beatport | `www.beatport.com`, `beatport.com` | `/track/<slug>/<id>`, id numérique | `/beatport/tracks/{id}` |
  | Bandcamp | `<sous-domaine>.bandcamp.com` | `/track/<slug>` | `/bandcamp/tracks?url=` avec l'URL normalisée |
  | SoundCloud | `soundcloud.com`, `www.soundcloud.com`, `m.soundcloud.com` | `/<utilisateur>/<slug>` (deux segments exactement) | `/soundcloud/resolve?url=` avec l'hôte réécrit en `soundcloud.com` |
  | SoundCloud, lien court | `on.soundcloud.com` | `/<code>` (un segment) | `/soundcloud/resolve?url=` |

  Sources de ces formes : l'URL publique Beatport (techno-scraper, `providers/beatport/parser.py`, `_PUBLIC_TRACK_URL`) ; le pattern de `/bandcamp/tracks`, qui rend `422` sur une query, `http://` ou `/album/` (`docs/knowledges/techno-scraper.md`) ; les variantes que SoundCloud rejette, « slash final, `www.` et `m.` → `404` ; `on.soundcloud.com/<code>` résolu vers la ressource réelle, parfois une playlist » (techno-scraper, `docs/knowledges/soundcloud.md`, constat du 2026-09-30). Sans cette normalisation, une URL copiée avec sa query prend un `422` Bandcamp, classé `ApiContractError` donc remonté à Sentry, et une URL `www.`, `m.` ou à slash final prend un `404` SoundCloud évitable. Le pattern Bandcamp tolère le slash final (`/?$`, `providers/bandcamp/router.py`, lu le 2026-10-03) : son retrait ne sert qu'à envoyer une forme unique quelle que soit la source.
- **Refus local par `UnsupportedTrackUrlError`**, code `unsupported_url`, héritée de `TaggerError` et non de `ScraperError` : aucune requête n'est partie, il n'y a pas de `request_id`. Aucun `params` ne porte l'URL, qui peut contenir le nom de l'artiste et du morceau (ARCHITECTURE.md § Sécurité : aucun titre ne part sans geste manuel ; `.claude/rules/python/gestion-erreurs.md`).
- **Réponse de `/soundcloud/resolve`** : la route rend `UserProfile | Track`, la clé `profile` signalant un profil (`docs/knowledges/techno-scraper.md`). La réponse est validée contre l'union d'un `TrackCandidate` et d'une enveloppe profil réduite à cette clé : un profil lève `UnsupportedTrackUrlError`, jamais une `ApiContractError`. `tracks_cursor` n'est jamais envoyé, il rendrait `400 cursor_scope_mismatch` sur un morceau.
- **Candidat lu tel que rendu** : `title`, `mix_name`, `artists`, `remixers` et `label` arrivent normalisés depuis techno-scraper 4.0.0 (ADR-012 de techno-scraper). Le client ne les redécoupe pas, `source_title` reste ignoré (`.claude/rules/techno-scraper/contrat.md`).
- **Réponses de l'API** : la table de traduction existante s'applique telle quelle. Un `404` donne `TrackNotFoundError` (morceau supprimé ou privé, lien court vers une playlist), un `503 quota_exceeded` SoundCloud donne `SourceUnavailableError` comme tout `5xx`, un `422` malgré la normalisation donne `ApiContractError` (dérive du contrat).
- **Sémaphore SoundCloud de 5**, constante `SOUNDCLOUD_CONCURRENCY` commentée comme miroir de la borne de l'API (techno-scraper, `core/limits.py`) et non comme réglage local (ADR-017, `.claude/rules/python/asyncio.md`). `_request`, `_get` et `_translate` passent de `SearchSource` à `Source`, `search` restant fermé sur Beatport et Bandcamp (`.claude/rules/python/type-hints.md`).
- **Cache** : la requête passe par `_get`, donc par `ResponseCache` sans changement. L'URL normalisée sert de clé : la même URL collée avec ou sans query tombe sur la même entrée.
- **Docs** : ARCHITECTURE.md et ADR-017 se modifient avec le skill `architecture-doc`, la fiche avec `knowledge-doc`, la rule avec `rules-doc`.
- **Qualité** : Ruff et Mypy strict (`.claude/rules/ruff/lint-format.md`, `.claude/rules/mypy/strict.md`), modèles selon `.claude/rules/pydantic/modeles.md`, client selon `.claude/rules/httpx2/client.md`, imports selon `.claude/rules/python/imports-modules.md`.

## Acceptance criteria

### Scénario 1 : URL Beatport
**GIVEN** l'URL `https://www.beatport.com/track/your-mind/22708005?utm_source=share`
**WHEN** le client la résout
**THEN** une seule requête part sur `/beatport/tracks/22708005`
**AND** le client rend le `TrackCandidate` de la réponse

### Scénario 2 : URL Bandcamp copiée avec une query
**GIVEN** l'URL `http://Artist.bandcamp.com/track/some-track/?from=search#lyrics`
**WHEN** le client la résout
**THEN** la requête part sur `/bandcamp/tracks` avec `url=https://artist.bandcamp.com/track/some-track`

### Scénario 3 : URL SoundCloud mobile
**GIVEN** l'URL `https://m.soundcloud.com/drumcode/kasia-faithless-tarantula-2?si=abc`
**WHEN** le client la résout
**THEN** la requête part sur `/soundcloud/resolve` avec `url=https://soundcloud.com/drumcode/kasia-faithless-tarantula-2`, sans `tracks_cursor`
**AND** le client rend un `TrackCandidate` de source `soundcloud`

### Scénario 4 : URL qui ne désigne pas un morceau
**GIVEN** une URL d'album Bandcamp, de playlist SoundCloud, de profil SoundCloud, de sortie Beatport, un hôte inconnu ou un texte sans schéma
**WHEN** le client la résout
**THEN** une `UnsupportedTrackUrlError` de code `unsupported_url` est levée
**AND** aucune requête n'a été émise

### Scénario 5 : Lien court résolu en profil
**GIVEN** un lien court `on.soundcloud.com` pour lequel l'API rend un `UserProfile`
**WHEN** le client le résout
**THEN** une `UnsupportedTrackUrlError` est levée

### Scénario 6 : Morceau introuvable
**GIVEN** une API qui rend `404` pour une URL Bandcamp de forme valide
**WHEN** le client la résout
**THEN** une `TrackNotFoundError` est levée

### Scénario 7 : Borne SoundCloud
**GIVEN** une API qui retient chaque requête un court instant, et dix URL SoundCloud résolues en même temps
**WHEN** les résolutions sont en cours
**THEN** jamais plus de 5 requêtes SoundCloud ne sont en vol en même temps

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_scraper_client_urls.py` :
  - resolves a beatport url through the track id route
  - resolves a bandcamp track url through the bandcamp track route
  - resolves a soundcloud track url through the resolve route without a tracks cursor
  - sends a soundcloud short link to the resolve route
  - drops the query string, the fragment and the trailing slash before sending (paramétré par source, `ids` en anglais)
  - lowercases the host and rewrites the www and mobile soundcloud hosts
  - rewrites an http url to https
  - refuses an url that is not a track without sending any request (paramétré : bandcamp album, soundcloud playlist, soundcloud profile, beatport release, unknown host, missing scheme)
  - refuses a soundcloud url that resolves to a profile
  - raises track not found when the api answers 404 for a well formed url
- `sidecar/tests/unit/test_scraper_client_concurrency.py` :
  - never keeps more than five soundcloud requests in flight

`test_error_translations.py` couvre sans ajout la traduction de `unsupported_url`. Aucun test ne vérifie `urllib.parse` ni pydantic : chacun échoue contre une régression de nos formes acceptées, de notre normalisation, de notre choix de route, de notre lecture de la clé `profile` ou de notre borne.

## Edge cases

- **Beatport avec préfixe de langue ou forme inconnue** (`/fr/track/...`) : refusé en `unsupported_url`. La forme se reconnaît sur l'URL publique que l'API elle-même rend, un préfixe s'ajoutera sur un cas réel constaté.
- **Sous-page de profil SoundCloud à deux segments** (`/<utilisateur>/likes`) : passe le contrôle local. L'API rend un profil (`unsupported_url`) ou un `404` (`TrackNotFoundError`). Lister les mots réservés de SoundCloud ferait vivre ici une connaissance de la source que SoundCloud tranche lui-même.
- **Lien court `on.soundcloud.com` vers une playlist** : impossible à distinguer sans appel, l'API rend `404`, donc `TrackNotFoundError`.
- **Quota SoundCloud épuisé** (`503 quota_exceeded`) : `SourceUnavailableError`, comme toute source injoignable.
- **URL déjà mise en cache sous une forme non normalisée** : impossible, la normalisation précède toute lecture du cache.

## Architectural decisions

### Décision : Emplacement de la reconnaissance d'URL

**Options envisagées :**
- **A. Sidecar seul** : une seule source de vérité. L'interface envoie tout texte non vide, le refus revient sans appel réseau.
- **B. Sidecar et indice dans l'interface** : logo à la frappe et bouton grisé comme dans la maquette, au prix d'une copie des hôtes en TypeScript gardée par un test de cohérence.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-29. Décider des sources acceptées est une règle métier, et une règle métier en TypeScript est au mauvais endroit quelle que soit sa taille (`.claude/CLAUDE.md` § Standards).
- La validation ne se limite pas à l'hôte : forme du chemin, query à retirer, préfixes SoundCloud à réécrire. Une copie côté interface serait partielle ou dupliquerait tout.

### Décision : Réponse profil de `/soundcloud/resolve`

**Options envisagées :**
- **A. `UnsupportedTrackUrlError`** : même message qu'une URL de profil refusée localement, l'utilisateur a collé un lien qui ne désigne pas un morceau.
- **B. `TrackNotFoundError`** : traite le profil comme un morceau absent, au risque de dire « le morceau n'existe plus » sur un lien valide vers un compte.

**Choix : A**

**Rationale :**
- Le profil n'arrive que par un lien court ou une sous-page à deux segments : c'est la même erreur de saisie qu'un profil reconnu localement, elle doit produire le même message.
- `TrackNotFoundError` reste réservé à ce que l'API ne trouve pas, ce qui garde son sens au rapport.
