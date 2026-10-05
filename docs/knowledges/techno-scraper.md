---
title: "techno-scraper — API gateway de métadonnées musicales"
version: "4.0.0"
description: "Référence technique pour techno-scraper : authentification, contrat Track normalisé, routes consommées, sémantique d'erreur et bornes de concurrence."
date: "2026-10-02"
keywords: ["techno-scraper", "api", "track", "source_title", "beatport", "bandcamp", "soundcloud", "x-api-key"]
scope: ["docs"]
technologies: ["httpx2", "Python", "FastAPI", "Pydantic"]
---

# Description

API gateway bas niveau qui expose Beatport, Bandcamp et SoundCloud derrière un contrat `Track` unique. C'est la **seule source de données** de techno-tagger : l'application ne scrape rien, ne parse aucun HTML et n'embarque aucune dépendance anti-bot (cf. [ADR-006](../adrs/006-scraping-delegue-techno-scraper.md)).

Le partage des responsabilités est posé par l'[ADR-002 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md) : **l'API ne fait ni fallback entre sources ni matching**. L'enchaînement Beatport → Bandcamp, le scoring rapidfuzz et l'arbitrage appartiennent au consommateur, donc au sidecar. Depuis l'[ADR-012 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/012-normalisation-des-champs-texte-en-sortie.md), elle normalise en revanche les champs texte qu'elle rend : le nettoyage du titre et des crédits n'est plus au sidecar.

Contrairement à une dépendance figée par un lockfile, l'API évolue en production sans que rien ne bouge côté application. Tout le contrat est donc isolé dans `scraper_client.py` (anti-corruption layer).

---

# Concepts Clés

## Authentification et garde fail-closed

### Description

Toutes les routes exigent un header `X-API-Key`, vérifié en garde globale fail-closed. `/health` est la seule exception, appelée sans clé par le healthcheck. Côté techno-tagger, la clé est saisie dans les Settings et stockée via keyring dans le Credential Manager Windows (cf. [ADR-012](../adrs/012-securite-cle-api-keyring.md)).

### Exemple

```python
import httpx2

client = httpx2.AsyncClient(
    base_url=api_url,
    headers={"X-API-Key": api_key},
    timeout=httpx2.Timeout(10.0, read=100.0),  # read au-dessus du budget de 90 s de l'API, le reste court (cf. httpx2.md § Timeouts)
)
```

### Points Importants

- **Clé absente et clé invalide rendent toutes deux `403`, jamais `401`.** Un `403` ne se retry pas : il remonte à l'utilisateur comme une clé à corriger dans les Settings
- **Jeu de clés nommées depuis le 2026-10-05** (ADR-013 de techno-scraper, [ADR-016](../adrs/016-multi-cles-techno-scraper.md)) : une variable `API_KEYS__<ID>` par clé, sans repli sur l'ancienne `API_KEY`. L'identifiant (`key_id`) sort dans le log d'accès et en tag Sentry, jamais dans une réponse. Rien ne change pour le sidecar
- `/openapi.json`, `/docs` et `/redoc` sont **désactivés en production** : la référence de contrat est le repo, pas une doc en ligne
- Le sidecar est le seul composant à appeler l'API, par la constante `API_BASE_URL` de `scraper_client.py` : la webview n'émet jamais de requête vers l'API et ne connaît pas son URL

---

## Contrat Track normalisé

### Description

Un modèle `Track` unique quel que soit le provider, avec un champ `source` qui trace l'origine (cf. [ADR-006 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md)). C'est ce qui rend le fallback cross-source mécanique côté sidecar : même forme à mapper vers les tags, quelle que soit la source interrogée.

### Exemple

```python
{
    "id": str | None,              # id de la source ; côté Beatport, clé du refetch /beatport/tracks/{id}
    "title": str,                  # nettoyé par la gateway (ADR-012), sans version ni invité
    "source_title": str | None,    # texte exact de la source, référence brute
    "mix_name": str | None,        # séparé du titre, pas collé entre parenthèses
    "artists": list[Profile],      # remixers exclus, par convention
    "remixers": list[Profile],
    "release": Release | None,     # id, title, source_title, catalog_number, release_date, artwork_url
    "label": Profile | None,
    "genre": str | None,
    "bpm": int | None,
    "key": str | None,             # notation Camelot (« 4A »)
    "isrc": str | None,
    "track_number": int | None,
    "url": str | None,
    "source": "beatport" | "bandcamp" | "soundcloud",
}
```

### Points Importants

- **Forme vérifiée sur techno-scraper 4.0.0** (`src/technoscraper/shared/schemas.py`, lu le 2026-10-02) : la date, le numéro de catalogue et la pochette vivent sous `release`, jamais à la racine, et `duration` n'existe pas. `Profile` porte bien d'autres champs (`bio`, `location`, `followers`, `social_links`, `kind`) que le sidecar ignore
- **Un champ nul ne signale pas une erreur mais une source qui ne l'expose pas.** Bandcamp ne rend ni `bpm`, ni `key`, ni `genre`. `label` n'est rendu que si le morceau est sur un compte de label, `None` sinon, là où Beatport les remplit tous. La politique d'écriture doit traiter ces nuls comme « champ non écrit », jamais comme « champ à vider » (cf. [ADR-011](../adrs/011-politique-ecriture-tags.md))
- **Convention consommateur : les remixers sont exclus de `artists[]`.** Reconstruire la chaîne artiste pour un tag suppose de décider si `remixers[]` y entre, l'API ne tranche pas à la place du consommateur
- `mix_name` est un champ à part : le recoller au titre est un choix d'écriture, pas une donnée
- **La recherche rend moins que le détail, et l'écart dépend de la source.** Sur Beatport, `/beatport/search` passe par le même mapper que `/beatport/tracks/{id}` : seul `track_number` y manque. Sur Bandcamp, `/bandcamp/search` ne rend ni `release.release_date`, ni `label`, ni `isrc`, ni `track_number` : le refetch par URL (`GET /bandcamp/tracks?url=`) est indispensable avant d'écrire
- `release.artwork_url` pointe le CDN de la source. Son téléchargement ne traverse donc pas l'API et ne consomme aucun de ses sémaphores, d'où le pool séparé de 6 côté sidecar (cf. [ADR-017](../adrs/017-taille-pool-concurrence.md))
- **`title` est nettoyé par la gateway** (ADR-012 de techno-scraper) : bruit (`Premiere`, `FREE DL`, `320kbps`, emoji, caractères invisibles), version, invité, label connu de la source et code catalogue en sont retirés ; `source_title` garde le texte exact. Un sous-titre entre parenthèses sans mot de version reste dans `title` (« PATT (Party All The Time) »), c'est le seul groupe que le sidecar retire encore, pour comparer à sa requête
- **`artists` arrive découpé** sur `;`, `/`, `x`, `vs`, `feat`, jamais sur `&` ni `and` (« Pig & Dan » reste un crédit), invités du titre compris ; `remixers` se lit dans la version (« Charlotte de Witte Rework » → Charlotte de Witte). Un champ structuré de la source prime toujours sur le parsing : Beatport garde ses listes v4, SoundCloud son `label_name` et son champ `release`
- **`label` et `release.catalog_number` lus dans le titre, selon la source** : sur SoundCloud, `label` vaut `label_name`, sinon l'uploader s'il est cité dans le titre, et le catalogue vaut le champ `release` de la source, sinon le code trouvé dans le titre ; sur Bandcamp, le catalogue vient du titre d'album (« Jaunde EP - OFF130 » → `OFF130`) mais `label` ne vient jamais du titre, seulement du compte hôte quand c'est un label ; sur Beatport, seul le catalogue retombe sur le titre de la release quand l'API v4 ne le donne pas

---

## Routes consommées par techno-tagger

### Description

L'application n'utilise qu'un sous-ensemble des routes exposées. La recherche automatique ne touche que Beatport et Bandcamp ; SoundCloud n'entre que par la saisie d'URL de fin de run.

### Exemple

```
GET /beatport/search?q=<artiste titre>&type=tracks&cursor=&limit=  → Page[Track]  (recherche auto, temps 1)
GET /beatport/tracks/{id}                                          → Track        (refetch, ajoute track_number)
GET /bandcamp/search?q=<artiste titre>&type=tracks&cursor=&limit=  → Page[Track]  (recherche auto, temps 2)
GET /bandcamp/tracks?url=<url bandcamp>                            → Track        (refetch après recherche, rattrapage par URL)
GET /soundcloud/resolve?url=<url soundcloud>                       → UserProfile | Track (rattrapage par URL ; Track sur l'URL d'un morceau, clé profile sur un profil)
# Beatport n'a pas de résolution par URL : extraire l'id de l'URL collée, puis /beatport/tracks/{id}
GET /health                                                        → 200          (sans clé, diagnostic de joignabilité)
```

### Points Importants

- **`/bandcamp/tracks` prend une `url`, pas un id**, validée par le pattern `^https://[a-z0-9][a-z0-9-]*\.bandcamp\.com/track/[\w-]+/?$` (garde anti-SSRF de la gateway) : `https` obligatoire, sous-domaine en minuscules, chemin `/track/<slug>` seul, aucune query string. Une URL collée avec `?from=…`, en `http://` ou vers un `/album/` rend `422` : la ramener à cette forme avant l'appel
- **`/soundcloud/resolve` rend `UserProfile | Track` selon l'URL** : la clé `profile` signale un profil, à traiter comme « pas un morceau » ; un `Track` se mappe comme les deux autres sources. La gateway n'impose aucun pattern sur cette `url`, elle part telle quelle à l'API SoundCloud : une URL de playlist, de set ou inconnue rend `404 not_found`, pas `422`. Passer `tracks_cursor` sur l'URL d'un morceau rend `400 cursor_scope_mismatch`
- SoundCloud n'est jamais interrogé en recherche automatique, ses métadonnées d'upload étant trop peu fiables (cf. [ADR-009](../adrs/009-enchainement-sources-et-arbitrage.md))
- **Bandcamp n'est jamais appelé spéculativement** : l'appel n'est déclenché que par un résultat vide côté Beatport ou par un refus explicite de l'utilisateur en arbitrage
- **`limit` et `cursor` existent sur les deux `/search`** : le sidecar fixe `limit=10` et ne relit jamais `cursor` (cf. § Pagination à curseur opaque)

---

## Sémantique « rien trouvé » vs « source down »

### Description

La distinction est contractuelle et conditionne toute la logique de fallback du sidecar : une liste vide est une réponse valide, une source cassée est une erreur.

### Exemple

```
200 + { "items": [], "next_cursor": null }       → rien trouvé, on enchaîne sur la source suivante
400  code=invalid_cursor | cursor_out_of_range   → curseur illisible, forgé ou hors fenêtre (Beatport)
400  code=cursor_limit_mismatch                  → curseur rejoué avec une autre taille de page (limit)
400  code=cursor_scope_mismatch                  → curseur rejoué sur une autre requête (q, type, id, filtre de date)
403                                              → clé absente ou invalide
404  code=not_found                              → ressource absente (id inconnu ; URL de /soundcloud/resolve ni profil ni morceau)
422                                              → paramètre de requête invalide, corps FastAPI standard
500  code=internal_error                         → erreur non gérée côté API
502  code=parse_error                            → structure de la source changée, côté API
503  code=source_unavailable                     → source injoignable après retries
503  code=stale_content                          → token Beatport ou SoundCloud déjà expiré à la pose (jamais sur Bandcamp)
503  code=quota_exceeded (SoundCloud uniquement) → quota de génération de tokens épuisé
504  code=request_timeout                        → budget de 90 s dépassé, file saturée

Corps 404, 502, 503 : { "code": "...", "provider": "...", "request_id": "..." }
Corps 400, 500, 504 : { "code": "...", "request_id": "..." }, sans provider
Corps 403, 422      : { "detail": ... }, défaut FastAPI, ni code ni request_id
En-tête sur toutes les réponses, succès compris : X-Request-ID
(le 500 le porte aussi, posé par `ServerErrorMiddleware` et non par le middleware commun)
```

### Points Importants

- **Forme vérifiée sur techno-scraper 4.0.0** (`core/errors.py`, `core/limits.py`, `core/security.py`, `core/token_service.py`, `shared/queries.py`, lus le 2026-10-02) : chaque code de statut ci-dessus correspond à un handler ou une garde nommée dans ces fichiers
- **Une `Page[T]` vide n'est jamais une erreur.** C'est le signal « ce morceau n'existe pas sur cette source », qui déclenche le fallback, à distinguer d'une panne qui, elle, ne dit rien sur le morceau
- **Un `504` ne se retry jamais immédiatement** : il signale une file saturée côté API, et un retry immédiat ne fait qu'y rajouter du travail
- **Le `504` prime sur le `503`** quand les deux sont possibles : une route enchaînant plusieurs `fetch` dépasse le budget avant d'avoir épuisé ses tentatives. Les deux se traitent pareil (source indisponible), seul le code diffère
- `502 parse_error` n'est pas actionnable côté application : c'est un parser à corriger côté API. Le morceau se traite comme non résolu, et le rapport doit le distinguer d'un « rien trouvé »
- **`422` est un contrat cassé, tout `5xx` une source indisponible, `500` compris** : un `422` dit que le sidecar a mal formé sa requête, c'est son bug. Un `500` dit que l'API a planté : le classer en contrat cassé le ferait remonter dans le Sentry du sidecar pour un incident que l'API remonte déjà dans le sien, alors que du point de vue de l'utilisateur la source n'a simplement pas répondu et que le morceau se rejouera. Le `503` couvre trois causes distinctes, traitées pareil : `source_unavailable` (source injoignable après retries, ou coupe-circuit ouvert après un `429`), `stale_content` (token Beatport ou SoundCloud déjà expiré à la pose, levé par `core/token_service.py`, jamais sur Bandcamp qui n'a pas de token) et `quota_exceeded` (quota de génération de tokens épuisé, **SoundCloud uniquement**)
- **Le retry est à la charge du consommateur** : l'API ne le fait pas pour lui, sa concurrence sortante étant mutualisée entre tous les consommateurs
- **Le corps d'erreur ne porte ni message ni trace** : `{code, provider, request_id}` sur 404, 502 et 503, sans `provider` sur 400, 500 et 504, et le `{"detail": ...}` par défaut de FastAPI sur 403 et 422. Inutile d'y chercher un texte à afficher, le libellé utilisateur appartient au sidecar. Le `request_id`, repris en en-tête `X-Request-ID` sur toutes les réponses, est le seul lien avec la ligne de log et l'issue Sentry côté API : le journaliser à chaque échec, depuis l'en-tête plutôt que le corps

---

## Pagination à curseur opaque

### Description

Toute route de liste rend une enveloppe `Page[T]` = `{ items, next_cursor }`. Le curseur encode la pagination native de chaque source et se renvoie **tel quel**, sans être lu (cf. [ADR-009 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md)).

### Exemple

```python
# Chemin de tagging : une seule page de 10, next_cursor ignoré
params = {"q": query, "type": "tracks", "limit": 10}
page = (await client.get("/beatport/search", params=params)).json()
candidates = page["items"]
# Itérer = renvoyer page["next_cursor"] tel quel en `cursor`, avec le même `limit`, jusqu'à null
```

### Points Importants

- **Le curseur est opaque et forward-only** : le décoder, le construire à la main ou le réutiliser sur une autre route est un contrat rompu
- **Le paramètre s'appelle `cursor` sur les deux `/search`, `tracks_cursor` sur `/soundcloud/resolve`**, où les morceaux sont une seconde collection à côté du profil. Les modèles de paramètres étant en `extra="forbid"`, se tromper de nom rend `422`, pas une première page
- **`limit` est une énumération fermée `5/10/25/50/100`, défaut `25`** : une valeur hors énumération rend `422`, jamais une page tronquée. Le sidecar passe `10`, taille fixe à chaque appel (`SEARCH_PAGE_SIZE`)
- **`next_cursor: null` signifie « fin de liste ».** Bandcamp rend tout d'un bloc, plafonné à 50, et la gateway découpe après réception : une page suivante refait l'appel à la source, ce que le tagger ne provoque jamais
- **Le tagger ne pagine pas en recherche** : seuls les premiers candidats sont scorés, un morceau au-delà de la première page n'étant pas un candidat plausible. Ne jamais relire un curseur : c'est ce qui rend `400 cursor_limit_mismatch` et `cursor_scope_mismatch` inatteignables

---

## Bornes de concurrence et budget de durée

### Description

L'API est le point de sortie IP unique vers les trois sources, et borne donc sa concurrence sortante **par source**. Le pool asyncio du sidecar est dimensionné en miroir de ces bornes (cf. [ADR-017](../adrs/017-taille-pool-concurrence.md)).

### Exemple

```python
# Miroir des sémaphores de sortie de l'API, pas un réglage de performance local
BEATPORT_CONCURRENCY = 3
BANDCAMP_CONCURRENCY = 2
ARTWORK_CONCURRENCY = 6   # CDN direct, ne traverse pas l'API : calibrage libre

REQUEST_TIMEOUT = 100.0   # > 90 s de budget API, pour recevoir le 504 structuré
```

### Points Importants

- **Bandcamp est borné à 2 et Beatport à 3 côté API.** Émettre davantage n'accélère rien : les requêtes s'empilent derrière le sémaphore distant, consomment le budget de 90 s et sortent en `504`
- Le `429` Bandcamp est constaté dès 3-4 requêtes simultanées côté API : la borne de 2 est mesurée, pas prudentielle
- **Bandcamp a aussi un quota de volume** : environ 185 appels par fenêtre de 3 minutes, quel que soit le débit (mesuré côté API le 2026-09-22). Atteint, la source refuse tout et l'API coupe ses appels vers elle pendant 30 s. Un `503 source_unavailable` sur `provider: bandcamp` peut donc être un quota et non une panne : relancer les morceaux `unresolved` concernés au plus tôt 3 minutes après
- **Le timeout client doit rester au-dessus du budget de l'API** (100 s pour 90 s), sinon on récolte un timeout local aveugle au lieu d'un `504` nommant la cause
- Les bornes de l'API sont **par processus** : elles ne protègent pas d'une deuxième instance de l'application tournant en parallèle, ce que le plugin `single-instance` de Tauri empêche par ailleurs pour d'autres raisons
- Le téléchargement des pochettes tape le CDN de la source, pas l'API : le compter dans le pool de 3 briderait les images pour rien

---

## Isolation du contrat dans `scraper_client.py`

### Description

Un seul module connaît les URLs, les codes d'erreur et la forme des réponses de l'API. Le reste du sidecar ne manipule que des modèles internes. C'est le pattern anti-corruption layer posé en [ARCHITECTURE.md § Patterns Utilisés](../ARCHITECTURE.md#patterns-utilisés).

### Exemple

```python
# scraper_client.py — seul endroit qui connaît le contrat de l'API
# `type` n'existe que sur beatport et bandcamp : /soundcloud/search rend des profils
async def search_tracks(
    self, source: Literal[Source.BEATPORT, Source.BANDCAMP], query: str
) -> list[TrackCandidate]:
    try:
        response = await self._client.get(f"/{source}/search", params={"q": query, "type": "tracks"})
        response.raise_for_status()
    except httpx2.HTTPStatusError as exc:
        raise self._to_domain_error(exc) from exc  # 403 / 5xx → erreurs métier
    return [TrackCandidate.from_api(item) for item in response.json()["items"]]
```

### Points Importants

- **Un changement d'API ne doit toucher qu'un fichier.** Si un code HTTP ou un nom de champ apparaît ailleurs dans le sidecar, la couche a fui
- Les modèles internes ne sont pas les modèles de l'API : un champ ajouté côté API est ignoré tant que le mapping ne le lit pas, ce qui rend l'application insensible aux ajouts
- L'API n'étant pas figée par un lockfile, elle peut évoluer entre deux runs sans qu'aucune dépendance ne bouge : la validation des réponses est une protection contre l'API, pas seulement contre le réseau

---

# Bonnes Pratiques

## ✅ Recommandations

- **Traiter la liste vide et l'erreur comme deux chemins distincts** : la première déclenche le fallback, la seconde marque le morceau non résolu avec son `failure_reason`
- **Incriminer la clé API sur un `403`, sans repasser par `/health`** : une clé absente comme une clé invalide rendent ce statut, qu'aucun autre cas ne produit, et une API injoignable rend un `5xx`. Compter les refus consécutifs plutôt que les interpréter un par un, une clé révoquée en produisant autant que de morceaux
- **Dimensionner les pools en miroir des sémaphores de l'API**, et documenter dans le code que ces nombres viennent d'une contrainte distante, pas d'un réglage local
- **Refetch après une recherche** avant d'écrire des tags : par id sur Beatport, où seul `track_number` manque, par URL sur Bandcamp, dont la recherche ne rend ni date, ni label, ni ISRC, ni numéro de piste
- **Lire `title`, `artists`, `mix_name`, `remixers` et `label` tels que rendus** : version, invité et séparateurs sont déjà traités par la gateway, et un second passage côté sidecar diverge de son corpus de test. Seul le nettoyage de la requête (tags et nom de fichier) reste au sidecar, la gateway ne voyant jamais ce qu'il envoie
- **Ramener une URL Bandcamp collée à `https://<compte>.bandcamp.com/track/<slug>`** avant `/bandcamp/tracks`, le pattern de la gateway rejetant query string et `http://` en `422`
- **Consigner le `source` de chaque morceau résolu dans le rapport** : c'est ce qui explique a posteriori pourquoi un `bpm` manque
- **Isoler tout le contrat dans `scraper_client.py`**, y compris le mapping des codes HTTP vers les erreurs métier

## ❌ Anti-Patterns

- **Retryer un `504` immédiatement** : la file est déjà saturée, le retry l'allonge
- **Retryer un `403`** : la clé ne redeviendra pas valide toute seule, c'est une action utilisateur
- **Traiter un champ nul comme une valeur à écrire** : effacer un `bpm` existant parce que Bandcamp ne le rend pas est une régression pour l'utilisateur
- **Redécouper `title` ou `artists` rendus par la gateway** : la version est déjà dans `mix_name`, l'invité dans `artists`, et `source_title` porte le texte brut pour qui en a besoin
- **Augmenter la concurrence pour accélérer un run** : au-delà des sémaphores de l'API, chaque requête en plus consomme le budget de 90 s et rapproche du `504`
- **Décoder ou fabriquer un curseur** : il est opaque par contrat et son encodage change avec la source
- **Compter les téléchargements de pochettes dans le pool de l'API** : elles vont au CDN de la source, l'API n'est pas sur ce chemin
- **Appeler Bandcamp spéculativement pour gagner du temps** : c'est une source à borne 2, et l'appel n'a de sens qu'après un échec Beatport
- **Laisser un code HTTP de l'API remonter dans le code métier** : la couche anti-corruption perd son intérêt dès la première fuite

---

# 🔗 Ressources

## Documentation Officielle

- [techno-scraper (production)](https://techno-scraper.empiricmind.fr)
- [Dépôt techno-scraper](https://github.com/thibaud57/techno-scraper)
- [ADR-002 : API gateway bas niveau](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md)
- [ADR-006 : Schéma Track normalisé](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md)
- [ADR-009 : Pagination cross-provider](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md)
- [ADR-012 : Normalisation des champs texte en sortie](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/012-normalisation-des-champs-texte-en-sortie.md)

## Ressources Complémentaires

- [ADR-006 : Scraping délégué à techno-scraper](../adrs/006-scraping-delegue-techno-scraper.md)
- [ADR-009 : Enchaînement des sources et arbitrage](../adrs/009-enchainement-sources-et-arbitrage.md)
- [ADR-016 : Multi-clés techno-scraper](../adrs/016-multi-cles-techno-scraper.md)
- [ADR-017 : Taille du pool de concurrence](../adrs/017-taille-pool-concurrence.md)
