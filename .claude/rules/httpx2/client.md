---
paths:
  - "sidecar/src/tagger/scraper_client.py"
  - "sidecar/src/tagger/cache.py"
---

# httpx2 — Client HTTP

## À faire
- `import httpx2` : le paquet ne s'importe pas `httpx`, et l'erreur passe inaperçue si `httpx` est installé par ailleurs
- Instancier deux `AsyncClient` au démarrage du sidecar, un par pool (API interne, CDN des pochettes), et les fermer par `await client.aclose()` à l'arrêt
- Poser les headers communs sur le client (`X-API-Key`) : ils sont fusionnés avec ceux de chaque requête
- Régler `Timeout` phase par phase, `read` au-dessus du budget de l'API et `pool` borné pour ne pas masquer une saturation locale
- Appeler `raise_for_status()` sur chaque réponse : sans lui, un `500` passe pour un succès et le mapping ne s'exécute jamais
- Distinguer `HTTPStatusError` (réponse reçue, statut d'erreur) de `RequestError` (aucune réponse : DNS, connexion, timeout local), le diagnostic utilisateur n'étant pas le même
- Télécharger une pochette par `stream()` en context manager, écrite au fil de `aiter_bytes()` vers le cache disque
- Injecter le transport en paramètre du constructeur : c'est ce qui rend `MockTransport` utilisable en test sans monkeypatch

## À éviter
- Créer un `AsyncClient` par requête : le pool de connexions ne sert alors à rien
- Compter sur `Limits` pour borner la concurrence applicative : il borne les connexions TCP, plusieurs requêtes pouvant partager une connexion keep-alive. La borne en requêtes est un sémaphore (cf. [asyncio.md](../python/asyncio.md))
- Installer `respx` ou `pytest-httpx` : ils ciblent `httpx`
- Retryer une requête dont le corps a été consommé : c'est `StreamConsumed`, il faut la reconstruire
- Sortir d'un `stream()` sans fermer le contexte : la connexion reste en vol
- Laisser un échec de téléchargement de pochette échouer le morceau : les tags s'écrivent sans image et le rapport le signale

## Gotchas
- httpx2 est le fork de httpx par Pydantic Services : API identique mais import `httpx2` et transport `httpcore2`, ce n'est pas un drop-in silencieux
- Vérification SSL par `truststore` (trust store de l'OS) au lieu de `certifi` : plus de `cacert.pem` à bundler, mais des appels `ctypes` vers l'API Windows dans le binaire figé, à valider au premier build PyInstaller
- Aucun mock HTTP ne supporte httpx2 (`respx` exige `httpx>=0.25.0`, `pytest-httpx` `httpx==0.28.*`) : la voie est `MockTransport`, natif et sans dépendance (cf. [tests.md](../pytest/tests.md))
- 2.12.0 : décompression bornée à 1 MiB par étape de décodage, et zstd natif sur Python 3.14+

## Exemples
```python
# ✅ un client par pool, instancié une fois, transport injectable
client_api = httpx2.AsyncClient(
    base_url=api_url,
    headers={"X-API-Key": api_key},
    timeout=httpx2.Timeout(connect=10.0, read=100.0, write=10.0, pool=10.0),
    transport=transport,
)

# ✅ deux familles d'erreurs, deux diagnostics
try:
    response = await client_api.get(path, params=params)
    response.raise_for_status()
except httpx2.HTTPStatusError as exc:
    raise map_api_error(exc.response) from exc
except httpx2.RequestError as exc:
    raise ApiUnreachableError() from exc

# ❌ Limits pris pour une borne de concurrence applicative
httpx2.AsyncClient(limits=httpx2.Limits(max_connections=3))
```
