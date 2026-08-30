---
title: "httpx2 — Client HTTP asynchrone du sidecar"
version: "2.12.0"
description: "Référence technique pour httpx2 : clients partagés, timeouts, limits vs sémaphores, streaming des pochettes, gestion d'erreurs et stratégie de test sans mock mature."
date: "2026-08-29"
keywords: ["httpx2", "asyncio", "http", "timeout", "streaming", "mocktransport"]
scope: ["docs"]
technologies: ["Python", "PyInstaller", "pytest"]
---

# Description

Client HTTP asynchrone, **fork de `httpx` maintenu par Pydantic Services**. Le sidecar l'utilise pour appeler techno-scraper et pour télécharger les pochettes sur les CDN des sources (cf. [ADR-007](../adrs/007-client-http-httpx2.md)).

**Le paquet s'importe `httpx2`, pas `httpx`.** L'API et le design sont annoncés identiques à httpx par ses mainteneurs, ce qui rend la documentation httpx transposable, mais les imports et l'écosystème d'outillage, eux, ne le sont pas.

Deux différences internes valent d'être connues : `certifi` est remplacé par `truststore` (magasin de certificats de l'OS) et `httpcore` est vendorisé dans le dépôt.

---

# Concepts Clés

## Un client par pool, instancié une fois

### Description

Deux pools distincts avec des contraintes distinctes : l'API interne, bornée par ses sémaphores de sortie, et les CDN de pochettes, bornés par simple politesse.

### Exemple

```python
client_api = httpx2.AsyncClient(
    base_url=api_url,
    headers={"X-API-Key": api_key},
    timeout=httpx2.Timeout(10.0, read=100.0),
)

client_cdn = httpx2.AsyncClient(
    limits=httpx2.Limits(max_connections=6, max_keepalive_connections=6),
)
```

### Points Importants

- **Un `AsyncClient` s'instancie au démarrage et se ferme au shutdown**, jamais par requête : c'est ce qui fait vivre le pool de connexions
- Les headers passés au client sont fusionnés avec ceux de chaque requête : `X-API-Key` n'a pas à être répété
- Fermer explicitement (`await client.aclose()`) à l'arrêt du sidecar, sinon des connexions restent ouvertes
- Deux clients séparés valent mieux qu'un seul : les timeouts et les limites de l'API n'ont rien à voir avec ceux d'un CDN d'images

---

## `Limits` n'est pas de la concurrence applicative

### Description

`httpx2.Limits` borne les **connexions TCP** au niveau du transport. Borner à 3 requêtes Beatport en vol et 2 pour Bandcamp est une contrainte applicative, qui demande un sémaphore.

### Exemple

```python
sem_beatport = asyncio.Semaphore(3)   # miroir du sémaphore de sortie de l'API
sem_bandcamp = asyncio.Semaphore(2)

async def search(source: str, query: str):
    sem = sem_beatport if source == "beatport" else sem_bandcamp
    async with sem:
        return await client_api.get(f"/{source}/search", params={"q": query})
```

### Points Importants

- **Un `Limits(max_connections=3)` ne garantit pas 3 requêtes en vol** : plusieurs requêtes peuvent partager une connexion keep-alive, et la file d'attente est invisible côté application
- Le sémaphore, lui, se compte en requêtes et se lit dans le code : c'est ce qui doit refléter les bornes de l'API
- **Ces nombres viennent de contraintes distantes**, pas d'un réglage de performance local (cf. [techno-scraper.md](techno-scraper.md))
- Le pool de pochettes (6) est le seul calibrage libre : aucun sémaphore distant ne le dicte

---

## Timeouts

### Description

Le timeout se règle par phase. Le point structurant du projet est le **read timeout à 100 secondes**, au-dessus du budget de 90 secondes de l'API.

### Exemple

```python
httpx2.Timeout(
    connect=10.0,   # établir la connexion
    read=100.0,     # > 90 s de budget API, pour recevoir son 504 structuré
    write=10.0,
    pool=10.0,      # attente d'une connexion libre dans le pool
)
```

### Points Importants

- **Un read timeout inférieur au budget de l'API produit un timeout local aveugle** au lieu du `504` structuré, qui, lui, nomme la cause
- `pool` borne l'attente d'une connexion : le laisser à l'infini masquerait une saturation locale
- Le timeout du client CDN n'a aucune raison d'être aussi long : une image qui met 100 secondes est un échec
- Un timeout dépassé lève une sous-classe de `RequestError`, pas de `HTTPStatusError`

---

## Gestion des erreurs

### Description

Deux familles distinctes : les réponses reçues avec un statut d'erreur, et les échecs avant réponse.

### Exemple

```python
try:
    response = await client_api.get(path, params=params)
    response.raise_for_status()
except httpx2.HTTPStatusError as exc:
    # réponse reçue : 403, 502, 503, 504 → erreurs métier nommées
    raise map_api_error(exc.response.status_code) from exc
except httpx2.RequestError as exc:
    # aucune réponse : DNS, connexion refusée, timeout local
    raise ApiUnreachableError() from exc
```

### Points Importants

- **`HTTPStatusError` et `RequestError` héritent tous deux de `HTTPError`** : les distinguer, parce que le diagnostic utilisateur diffère (« l'API a répondu une erreur » vs « l'API est injoignable »)
- `raise_for_status()` ne lève rien tant qu'il n'est pas appelé : une réponse 500 non vérifiée passe pour un succès
- `exc.response` porte le corps : le `code` structuré de l'API s'y lit
- **Aucun retry n'est intégré au client** : il se fait à l'appelant, en respectant la règle « un `504` ne se retry jamais immédiatement »

---

## Streaming des pochettes

### Description

Une pochette se télécharge en flux vers le cache disque, sans passer par la mémoire.

### Exemple

```python
async with client_cdn.stream("GET", artwork_url) as response:
    response.raise_for_status()
    with cache_path.open("wb") as fh:
        async for chunk in response.aiter_bytes():
            fh.write(chunk)
```

### Points Importants

- **`stream()` s'utilise en context manager** : sortir sans fermer laisse la connexion en vol
- La 2.12.0 borne la décompression à 1 MiB par étape de décodage : une réponse fortement compressée ne matérialise plus un chunk inflaté entier en mémoire
- `response.num_bytes_downloaded` suit la progression si besoin
- **Un échec de téléchargement n'échoue jamais le morceau** : les tags sont écrits sans pochette et le rapport le signale
- Rejouer une requête dont le corps a déjà été consommé lève `StreamConsumed` : un retry doit repartir d'une requête neuve

---

## Tester sans mock mature

### Description

C'est le point critique de la dépendance. `respx` et `pytest-httpx` ciblent `httpx` et ne supportent pas `httpx2`. La voie native est `MockTransport`, injecté à la construction du client.

### Exemple

```python
def handler(request: httpx2.Request) -> httpx2.Response:
    if request.url.path == "/beatport/search":
        return httpx2.Response(200, json={"items": [], "next_cursor": None})
    return httpx2.Response(504, json={"code": "request_timeout"})

client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
```

### Points Importants

- **`MockTransport` n'a besoin d'aucune dépendance** : il fait partie de httpx2 et se substitue au transport réel
- Un paquet `pytest-httpx2` existe et enveloppe respx, mais **son dépôt est jeune et peu adopté** : en dépendre revient à parier sur sa maintenance
- **Construire le client au même endroit que le code de production**, avec le transport en paramètre injectable : c'est ce qui rend le mock possible sans monkeypatch
- Les cas à couvrir en priorité sont ceux qui pilotent le fallback : `200` avec liste vide, `403`, `504`
- Conformément à la règle du projet, ne pas tester le comportement de la bibliothèque elle-même, seulement le mapping des réponses vers les erreurs métier

---

# Bonnes Pratiques

## ✅ Recommandations

- **Instancier les clients une fois au démarrage** et les fermer à l'arrêt
- **Deux clients pour deux pools** : API interne et CDN n'ont ni les mêmes timeouts ni les mêmes contraintes
- **Borner la concurrence par sémaphore**, `Limits` ne servant qu'à cadrer les connexions TCP
- **Garder le read timeout au-dessus du budget de l'API** et commenter pourquoi dans le code
- **Injecter le transport dans le constructeur du client** pour rendre `MockTransport` utilisable en test
- **Distinguer `HTTPStatusError` et `RequestError`** dans le mapping vers les erreurs métier

## ❌ Anti-Patterns

- **`import httpx`** : le paquet s'importe `httpx2`, et l'erreur peut passer inaperçue si `httpx` est installé par ailleurs
- **Créer un `AsyncClient` par requête** : le pool de connexions ne sert alors à rien
- **Compter sur `Limits` pour borner la concurrence applicative** : ce n'est pas la même unité
- **Oublier `raise_for_status()`** : une réponse d'erreur passe alors pour un succès et le mapping ne s'exécute jamais
- **Installer respx ou pytest-httpx** en espérant qu'ils fonctionnent : ils ciblent `httpx`
- **Retryer une requête dont le corps a été consommé** : `StreamConsumed`, il faut la reconstruire
- **Sortir d'un `stream()` sans fermer le contexte** : la connexion reste en vol

---

# 🔗 Ressources

## Documentation Officielle

- [httpx2](https://httpx2.pydantic.dev/)
- [Clients](https://httpx2.pydantic.dev/advanced/clients/) · [Timeouts](https://httpx2.pydantic.dev/advanced/timeouts/) · [Resource limits](https://httpx2.pydantic.dev/advanced/resource-limits/)
- [Transports](https://httpx2.pydantic.dev/advanced/transports/) · [Exceptions](https://httpx2.pydantic.dev/exceptions/)
- [Dépôt pydantic/httpx2](https://github.com/pydantic/httpx2)

## Ressources Complémentaires

- [ADR-007 — Client HTTP httpx2](../adrs/007-client-http-httpx2.md)
- [ADR-017 — Taille du pool de concurrence](../adrs/017-taille-pool-concurrence.md)
- [techno-scraper.md](techno-scraper.md) — bornes de l'API et sémantique d'erreur
