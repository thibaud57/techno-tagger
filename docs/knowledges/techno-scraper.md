---
title: "techno-scraper — API gateway de métadonnées musicales"
version: "3.1.2"
description: "Référence technique pour techno-scraper : authentification, contrat Track normalisé, routes consommées, sémantique d'erreur et bornes de concurrence."
date: "2026-08-29"
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
    timeout=httpx2.Timeout(100.0),  # au-dessus du budget de 90 s de l'API
)
```

### Points Importants

- **Clé absente et clé invalide rendent toutes deux `403`, jamais `401`.** Un `403` ne se retry pas : il remonte à l'utilisateur comme une clé à corriger dans les Settings
- Une clé par utilisateur, l'API en accepte plusieurs (cf. [ADR-016](../adrs/016-multi-cles-techno-scraper.md))
- `/openapi.json`, `/docs` et `/redoc` sont **désactivés en production** : la référence de contrat est le repo, pas une doc en ligne
- Le sidecar est le seul composant à appeler l'API. L'URL est persistée côté Tauri dans le `store` mais transmise au sidecar par la commande `set_api_url` — la webview n'émet jamais de requête vers l'API

---

## Contrat Track normalisé

### Description

Un modèle `Track` unique quel que soit le provider, avec un champ `source` qui trace l'origine (cf. [ADR-006 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md)). C'est ce qui rend le fallback cross-source mécanique côté sidecar : même forme à mapper vers les tags, quelle que soit la source interrogée.

### Exemple

```python
{
    "title": str,
    "mix_name": str | None,        # séparé du titre, pas collé entre parenthèses
    "artists": list[Artist],       # remixers exclus, par convention
    "remixers": list[Artist],
    "release": Release | None,
    "label": Label | None,
    "catalog_number": str | None,  # vient de la RELEASE Beatport, pas du track
    "release_date": date | None,
    "genre": str | None,
    "bpm": int | None,
    "key": str | None,
    "isrc": str | None,
    "duration": int | None,
    "track_number": int | None,
    "artwork_url": str | None,     # pointe le CDN de la source, pas l'API
    "url": str,
    "source": "beatport" | "bandcamp" | "soundcloud",
}
```

### Points Importants

- **Un champ nul ne signale pas une erreur mais une source qui ne l'expose pas.** Bandcamp ne rend ni `bpm`, ni `key`, ni `genre`. `label` n'est rendu que si le morceau est sur un compte de label, `None` sinon, là où Beatport les remplit tous. La politique d'écriture doit traiter ces nuls comme « champ non écrit », jamais comme « champ à vider » (cf. [ADR-011](../adrs/011-politique-ecriture-tags.md))
- **Convention consommateur : les remixers sont exclus de `artists[]`.** Reconstruire la chaîne artiste pour un tag suppose de décider si `remixers[]` y entre, l'API ne tranche pas à la place du consommateur
- `mix_name` est un champ à part : le recoller au titre est un choix d'écriture, pas une donnée
- **Sur `search`, les objets sont parfois abrégés** : un refetch par id (`GET /beatport/tracks/{id}`) est nécessaire pour des métadonnées complètes
- `artwork_url` pointe le CDN de la source. Son téléchargement ne traverse donc pas l'API et ne consomme aucun de ses sémaphores, d'où le pool séparé de 6 côté sidecar (cf. [ADR-017](../adrs/017-taille-pool-concurrence.md))

---

## Routes consommées par techno-tagger

### Description

L'application n'utilise qu'un sous-ensemble des routes exposées. La recherche automatique ne touche que Beatport et Bandcamp ; SoundCloud n'entre que par la saisie d'URL de fin de run.

### Exemple

```
GET /beatport/search?q=<artiste titre>&type=tracks&cursor=  → Page[Track]  (recherche auto, temps 1)
GET /beatport/tracks/{id}                                   → Track        (refetch metadata complètes)
GET /bandcamp/search?q=<artiste titre>&type=tracks          → Page[Track]  (recherche auto, temps 2)
GET /bandcamp/tracks?url=<url bandcamp>                     → Track        (rattrapage par URL)
GET /soundcloud/resolve?url=<url soundcloud>                → UserProfile  (rattrapage par URL uniquement)
# Beatport n'a pas de résolution par URL : extraire l'id de l'URL collée, puis /beatport/tracks/{id}
GET /health                                                 → 200          (sans clé, diagnostic de joignabilité)
```

### Points Importants

- **`/bandcamp/tracks` prend une `url`, pas un id**, et cette URL est contrainte par pattern au domaine de la source. Une URL hors domaine est rejetée à la validation
- **`/soundcloud/resolve` rend une enveloppe `UserProfile` (`{ profile, tracks }`), pas un `Track`** : le chemin de rattrapage SoundCloud ne se mappe pas comme les deux autres
- SoundCloud n'est jamais interrogé en recherche automatique, ses métadonnées d'upload étant trop peu fiables (cf. [ADR-009](../adrs/009-enchainement-sources-et-arbitrage.md))
- **Bandcamp n'est jamais appelé spéculativement** : l'appel n'est déclenché que par un résultat vide côté Beatport ou par un refus explicite de l'utilisateur en arbitrage

---

## Sémantique « rien trouvé » vs « source down »

### Description

La distinction est contractuelle et conditionne toute la logique de fallback du sidecar : une liste vide est une réponse valide, une source cassée est une erreur.

### Exemple

```
200 + { "items": [], "next_cursor": null }   → rien trouvé, on enchaîne sur la source suivante
502  code=parse_error                        → structure de la source changée, côté API
503  code=source_unavailable | stale_content → source injoignable après retries
504  code=request_timeout                    → budget de 90 s dépassé, file saturée
403                                          → clé absente ou invalide
```

### Points Importants

- **Une `Page[T]` vide n'est jamais une erreur.** C'est le signal « ce morceau n'existe pas sur cette source », qui déclenche le fallback, à distinguer d'une panne qui, elle, ne dit rien sur le morceau
- **Un `504` ne se retry jamais immédiatement** : il signale une file saturée côté API, et un retry immédiat ne fait qu'y rajouter du travail
- **Le `504` prime sur le `503`** quand les deux sont possibles : une route enchaînant plusieurs `fetch` dépasse le budget avant d'avoir épuisé ses tentatives. Les deux se traitent pareil (source indisponible), seul le code diffère
- `502 parse_error` n'est pas actionnable côté application : c'est un parser à corriger côté API. Le morceau se traite comme non résolu, et le rapport doit le distinguer d'un « rien trouvé »
- **Le retry est à la charge du consommateur** : l'API ne le fait pas pour lui, sa concurrence sortante étant mutualisée entre tous les consommateurs

---

## Pagination à curseur opaque

### Description

Toute route de liste rend une enveloppe `Page[T]` = `{ items, next_cursor }`. Le curseur encode la pagination native de chaque source et se renvoie **tel quel**, sans être lu (cf. [ADR-009 de techno-scraper](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md)).

### Exemple

```python
async def search_all(client, query: str) -> list[dict]:
    items, cursor = [], None
    while True:
        params = {"q": query, "type": "tracks"}
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
- `next_cursor: null` signifie « fin de liste », y compris quand la source ne pagine pas du tout — c'est le cas de `/bandcamp/search`
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
async def search_tracks(self, source: Source, query: str) -> list[TrackCandidate]:
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
- **Vérifier la joignabilité par `/health`** (sans clé) avant d'incriminer la clé API : ça sépare « API down » de « clé invalide » dans le diagnostic
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
- [ADR-002 — API gateway bas niveau](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md)
- [ADR-006 — Schéma Track normalisé](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md)
- [ADR-009 — Pagination cross-provider](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/009-pagination-cross-provider.md)

## Ressources Complémentaires

- [ADR-006 — Scraping délégué à techno-scraper](../adrs/006-scraping-delegue-techno-scraper.md)
- [ADR-009 — Enchaînement des sources et arbitrage](../adrs/009-enchainement-sources-et-arbitrage.md)
- [ADR-016 — Multi-clés techno-scraper](../adrs/016-multi-cles-techno-scraper.md)
- [ADR-017 — Taille du pool de concurrence](../adrs/017-taille-pool-concurrence.md)
