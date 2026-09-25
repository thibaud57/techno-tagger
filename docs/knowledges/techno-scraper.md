---
title: "techno-scraper — API gateway de métadonnées musicales"
version: "3.2.0"
description: "Référence technique pour techno-scraper : authentification, contrat Track normalisé, routes consommées, sémantique d'erreur et bornes de concurrence."
date: "2026-09-22"
keywords: ["techno-scraper", "api", "track", "beatport", "bandcamp", "soundcloud", "x-api-key"]
scope: ["docs"]
technologies: ["httpx2", "Python", "FastAPI", "Pydantic"]
---

# Description

API gateway bas niveau qui expose Beatport, Bandcamp et SoundCloud derrière un contrat `Track` unique. C'est la **seule source de données** de techno-tagger : l'application ne scrape rien, ne parse aucun HTML et n'embarque aucune dépendance anti-bot (cf. [ADR-006](../adrs/006-scraping-delegue-techno-scraper.md)).

Le partage des responsabilités est posé par l'[ADR-002 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md) : **l'API ne fait ni fallback ni matching**. L'enchaînement Beatport → Bandcamp, le scoring rapidfuzz et l'arbitrage appartiennent au consommateur, donc au sidecar.

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
- **Une seule clé aujourd'hui** : [`core/security.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/security.py) compare contre `settings.api_key`, une valeur unique. Le passage à un jeu de clés nommées est acté ([ADR-016](../adrs/016-multi-cles-techno-scraper.md)) mais reste un chantier côté techno-scraper, pas encore livré ([techno-scraper#73](https://github.com/thibaud57/techno-scraper/issues/73))
- `/openapi.json`, `/docs` et `/redoc` sont **désactivés en production** : la référence de contrat est le repo, pas une doc en ligne
- Le sidecar est le seul composant à appeler l'API. L'URL est une constante du sidecar (`API_BASE_URL` de `scraper_client.py`, décision du 2026-09-19) : la webview n'émet jamais de requête vers l'API et ne connaît pas son URL

---

## Contrat Track normalisé

### Description

Un modèle `Track` unique quel que soit le provider, avec un champ `source` qui trace l'origine (cf. [ADR-006 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md)). C'est ce qui rend le fallback cross-source mécanique côté sidecar : même forme à mapper vers les tags, quelle que soit la source interrogée.

### Exemple

```python
{
    "id": str | None,              # id Beatport, clé du refetch /beatport/tracks/{id}
    "title": str,
    "mix_name": str | None,        # séparé du titre, pas collé entre parenthèses
    "artists": list[Profile],      # remixers exclus, par convention
    "remixers": list[Profile],
    "release": Release | None,     # id, title, catalog_number, release_date, artwork_url
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

- **Forme vérifiée sur techno-scraper 3.1.3** (`src/technoscraper/shared/schemas.py`, lu le 2026-09-19) : la date, le numéro de catalogue et la pochette vivent sous `release`, jamais à la racine, et `duration` n'existe pas. `Profile` porte bien d'autres champs (`bio`, `followers`, `social_links`) que le sidecar ignore
- **Un champ nul ne signale pas une erreur mais une source qui ne l'expose pas.** Bandcamp ne rend ni `bpm`, ni `key`, ni `genre`. `label` n'est rendu que si le morceau est sur un compte de label, `None` sinon, là où Beatport les remplit tous. La politique d'écriture doit traiter ces nuls comme « champ non écrit », jamais comme « champ à vider » (cf. [ADR-011](../adrs/011-politique-ecriture-tags.md))
- **Convention consommateur : les remixers sont exclus de `artists[]`.** Reconstruire la chaîne artiste pour un tag suppose de décider si `remixers[]` y entre, l'API ne tranche pas à la place du consommateur
- `mix_name` est un champ à part : le recoller au titre est un choix d'écriture, pas une donnée
- **Sur `search`, les objets sont abrégés** : un refetch est nécessaire pour des métadonnées complètes, par id sur Beatport (`GET /beatport/tracks/{id}`), par URL sur Bandcamp (`GET /bandcamp/tracks?url=`), dont la recherche ne rend ni date, ni label, ni ISRC, ni numéro de piste
- `release.artwork_url` pointe le CDN de la source. Son téléchargement ne traverse donc pas l'API et ne consomme aucun de ses sémaphores, d'où le pool séparé de 6 côté sidecar (cf. [ADR-017](../adrs/017-taille-pool-concurrence.md))

---

## Routes consommées par techno-tagger

### Description

L'application n'utilise qu'un sous-ensemble des routes exposées. La recherche automatique ne touche que Beatport et Bandcamp ; SoundCloud n'entre que par la saisie d'URL de fin de run.

### Exemple

```
GET /beatport/search?q=<artiste titre>&type=tracks&cursor=&limit=  → Page[Track]  (recherche auto, temps 1)
GET /beatport/tracks/{id}                                          → Track        (refetch metadata complètes)
GET /bandcamp/search?q=<artiste titre>&type=tracks&cursor=&limit=  → Page[Track]  (recherche auto, temps 2)
GET /bandcamp/tracks?url=<url bandcamp>                            → Track        (rattrapage par URL)
GET /soundcloud/resolve?url=<url soundcloud>                       → UserProfile  (rattrapage par URL uniquement)
# Beatport n'a pas de résolution par URL : extraire l'id de l'URL collée, puis /beatport/tracks/{id}
GET /health                                                        → 200          (sans clé, diagnostic de joignabilité)
```

### Points Importants

- **`/bandcamp/tracks` prend une `url`, pas un id**, et cette URL est contrainte par pattern au domaine de la source. Une URL hors domaine est rejetée à la validation
- **`/soundcloud/resolve` rend une enveloppe `UserProfile` (`{ profile, tracks }`), pas un `Track`** : le chemin de rattrapage SoundCloud ne se mappe pas comme les deux autres
- SoundCloud n'est jamais interrogé en recherche automatique, ses métadonnées d'upload étant trop peu fiables (cf. [ADR-009](../adrs/009-enchainement-sources-et-arbitrage.md))
- **Bandcamp n'est jamais appelé spéculativement** : l'appel n'est déclenché que par un résultat vide côté Beatport ou par un refus explicite de l'utilisateur en arbitrage
- **`limit` arrive sur `/beatport/search` et `/bandcamp/search`**, depuis la `3.2.0` (déployée le 2026-09-22), absent en `3.1.4`. `/bandcamp/search` y gagne aussi un `cursor` réellement fonctionnel, absent de son modèle en `3.1.4` : Beatport en avait déjà un. Cf. § Pagination à curseur opaque pour le détail du paramètre

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
404  code=not_found                              → ressource absente (id inconnu)
422                                              → paramètre de requête invalide, corps FastAPI standard
500  code=internal_error                         → erreur non gérée côté API
502  code=parse_error                            → structure de la source changée, côté API
503  code=source_unavailable                     → source injoignable après retries
503  code=stale_content                          → contenu périmé servi par un cache amont
503  code=quota_exceeded (SoundCloud uniquement) → quota de génération de tokens épuisé
504  code=request_timeout                        → budget de 90 s dépassé, file saturée

Corps 404, 502, 503 : { "code": "...", "provider": "...", "request_id": "..." }
Corps 400, 500, 504 : { "code": "...", "request_id": "..." }, sans provider
Corps 403, 422      : { "detail": ... }, défaut FastAPI, ni code ni request_id
En-tête sur toutes les réponses, succès compris : X-Request-ID
(le 500 le porte aussi, posé par `ServerErrorMiddleware` et non par le middleware commun)
```

### Points Importants

- **Forme vérifiée sur techno-scraper 3.1.3** (`core/errors.py`, `core/limits.py`, `core/security.py`, `shared/queries.py`, lus le 2026-09-20) : chaque code de statut ci-dessous correspond à un handler ou une garde nommée dans ces fichiers
- **Une `Page[T]` vide n'est jamais une erreur.** C'est le signal « ce morceau n'existe pas sur cette source », qui déclenche le fallback, à distinguer d'une panne qui, elle, ne dit rien sur le morceau
- **Un `504` ne se retry jamais immédiatement** : il signale une file saturée côté API, et un retry immédiat ne fait qu'y rajouter du travail
- **Le `504` prime sur le `503`** quand les deux sont possibles : une route enchaînant plusieurs `fetch` dépasse le budget avant d'avoir épuisé ses tentatives. Les deux se traitent pareil (source indisponible), seul le code diffère
- `502 parse_error` n'est pas actionnable côté application : c'est un parser à corriger côté API. Le morceau se traite comme non résolu, et le rapport doit le distinguer d'un « rien trouvé »
- **`422` est un contrat cassé, tout `5xx` une source indisponible, `500` compris** : un `422` dit que le sidecar a mal formé sa requête, c'est son bug. Un `500` dit que l'API a planté : le classer en contrat cassé le ferait remonter dans le Sentry du sidecar pour un incident que l'API remonte déjà dans le sien, alors que du point de vue de l'utilisateur la source n'a simplement pas répondu et que le morceau se rejouera. Le `503` couvre trois causes distinctes, traitées pareil : `source_unavailable` (source injoignable après retries), `stale_content` (contenu périmé servi par un cache amont, atteignable sur n'importe quelle source) et `quota_exceeded` (quota de génération de tokens épuisé, **SoundCloud uniquement**)
- **`cursor_out_of_range` est un `400`, pas un `422`** : même corps qu'`invalid_cursor`, sans `provider`, malgré le nom qui évoque une validation de paramètre
- **`cursor_limit_mismatch` et `cursor_scope_mismatch` sont deux `400` distincts** : le premier sanctionne une taille de page (`limit`) qui change en cours d'itération, le second un curseur rejoué sur une autre requête (`q`, `type`, un autre id d'entité, un autre filtre de date). Sans cette garde la position pointerait en silence dans un tout autre ensemble de résultats. Depuis la `3.2.0` (`shared/queries.py`, `core/pagination.py`, `core/errors.py`)
- **Le `500` pose lui-même l'en-tête `X-Request-ID`** : il est rendu par `ServerErrorMiddleware`, hors du middleware qui pose cet en-tête pour toutes les autres réponses. C'est le seul code qui ne suit pas la règle générale ci-dessous
- **Le retry est à la charge du consommateur** : l'API ne le fait pas pour lui, sa concurrence sortante étant mutualisée entre tous les consommateurs
- **Le corps d'erreur ne porte ni message ni trace** : `{code, provider, request_id}` sur 404, 502 et 503, sans `provider` sur 400, 500 et 504, et le `{"detail": ...}` par défaut de FastAPI sur 403 et 422. Inutile d'y chercher un texte à afficher, le libellé utilisateur appartient au sidecar. Le `request_id`, repris en en-tête `X-Request-ID` sur toutes les réponses, est le seul lien avec la ligne de log et l'issue Sentry côté API : le journaliser à chaque échec, depuis l'en-tête plutôt que le corps

---

## Pagination à curseur opaque

### Description

Toute route de liste rend une enveloppe `Page[T]` = `{ items, next_cursor }`. Le curseur encode la pagination native de chaque source et se renvoie **tel quel**, sans être lu (cf. [ADR-009 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md)).

### Exemple

```python
async def search_all(client, query: str) -> list[dict]:
    items, cursor = [], None
    limit = 25  # doit rester identique sur tout l'appel, sous peine de 400 cursor_limit_mismatch
    while True:
        params = {"q": query, "type": "tracks", "limit": limit}
        if cursor:
            params["cursor"] = cursor
        page = (await client.get("/beatport/search", params=params)).json()
        items += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return items
```

### Points Importants

- **Le curseur est opaque et forward-only** : le décoder, le construire à la main ou le réutiliser sur une autre route est un contrat rompu
- **Le paramètre ne s'appelle pas `cursor` partout** : c'est `cursor` sur `/beatport/search` et `/soundcloud/users/{id}/likes`, mais **`tracks_cursor`** sur `/soundcloud/resolve` et `/soundcloud/users/{id}`, où les morceaux sont une seconde collection à côté du profil. Les modèles de paramètres de l'API étant en `extra="forbid"`, se tromper de nom rend `422`, pas une première page
- **`next_cursor: null` signifie « fin de liste » sur toutes les routes.** La source Bandcamp (`app_autocomplete`) n'accepte ni `limit` ni `offset` et rend tout d'un bloc, plafonné à 50 : c'est la gateway qui pagine `/bandcamp/search` par découpe après réception, avec un curseur d'offset : deux appels au plus à la taille par défaut (`25`), jusqu'à cinq à `limit=10`, dix à `limit=5`, vu ce plafond source. Depuis la `3.2.0`
- **`limit` est une énumération fermée `5/10/25/50/100`, défaut `25`**, sur les six routes rendant `Page[T]` (les trois `/search`, les deux discographies Beatport, `/soundcloud/users/{id}/likes`) : une valeur hors énumération rend `422`, jamais une page tronquée en silence. Il doit rester identique pendant toute l'itération, le curseur le porte et un écart rend `400 cursor_limit_mismatch`
- **Le curseur porte aussi une empreinte des paramètres qui définissent l'ensemble de résultats** (`q`/`type` pour une recherche, genre d'entité, id et filtre de date pour une discographie Beatport, id de compte et collection pour SoundCloud) : le rejouer sur une autre requête ou une autre collection rend `400 cursor_scope_mismatch`, distinct de `cursor_limit_mismatch`
- **Le tagger ne pagine pas en recherche** : seuls les premiers candidats sont scorés, un morceau au-delà de la première page n'étant pas un candidat plausible. La boucle ci-dessus vaut pour les usages exhaustifs (discographie), pas pour le chemin de tagging
- Beatport plafonne sa fenêtre de recherche à 10 000 résultats cumulés (mesuré côté API le 2026-08-09) : au-delà, `400 cursor_out_of_range`

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
- **Bandcamp a aussi un quota de volume** : environ 185 appels par fenêtre de 3 minutes, quel que soit le débit (mesuré côté API le 2026-09-22). Atteint, la source refuse tout et l'API coupe ses appels vers elle pendant 30 s (`3.2.0`). Un `503 source_unavailable` sur `provider: bandcamp` peut donc être un quota et non une panne : relancer les morceaux `unresolved` concernés au plus tôt 3 minutes après
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
        raise self._to_domain_error(exc) from exc  # 403/502/503/504 → erreurs métier
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
- **Refetch par id après une recherche** avant d'écrire des tags, les objets de `search` pouvant être abrégés
- **Consigner le `source` de chaque morceau résolu dans le rapport** : c'est ce qui explique a posteriori pourquoi un `bpm` manque
- **Isoler tout le contrat dans `scraper_client.py`**, y compris le mapping des codes HTTP vers les erreurs métier

## ❌ Anti-Patterns

- **Retryer un `504` immédiatement** : la file est déjà saturée, le retry l'allonge
- **Retryer un `403`** : la clé ne redeviendra pas valide toute seule, c'est une action utilisateur
- **Traiter un champ nul comme une valeur à écrire** : effacer un `bpm` existant parce que Bandcamp ne le rend pas est une régression pour l'utilisateur
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

## Ressources Complémentaires

- [ADR-006 : Scraping délégué à techno-scraper](../adrs/006-scraping-delegue-techno-scraper.md)
- [ADR-009 : Enchaînement des sources et arbitrage](../adrs/009-enchainement-sources-et-arbitrage.md)
- [ADR-016 : Multi-clés techno-scraper](../adrs/016-multi-cles-techno-scraper.md)
- [ADR-017 : Taille du pool de concurrence](../adrs/017-taille-pool-concurrence.md)
