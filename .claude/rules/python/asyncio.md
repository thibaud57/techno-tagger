---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python asyncio — Règles

## À faire
- Entrer par `asyncio.run(main())`, une seule fois ; `asyncio.get_running_loop()` si une référence au loop est nécessaire
- Lancer les tâches concurrentes avec `asyncio.TaskGroup` et lire les résultats via les handles après le bloc
- Borner la concurrence par un `asyncio.Semaphore` par source, aux tailles fixées par [ARCHITECTURE.md § Concurrence](../../../docs/ARCHITECTURE.md#concurrence) ; le pool des pochettes est distinct de celui des sources
- Poser un `asyncio.timeout(...)` sur un enchaînement d'étapes à borner globalement, le timeout par phase d'une requête étant réglé sur le client HTTP (cf. [client.md](../httpx2/client.md)) ; dans les deux cas au-dessus du budget de l'API, pour recevoir son 504 structuré plutôt qu'un timeout local aveugle
- Déléguer tout appel bloquant (mutagen, sqlite3, keyring, système de fichiers) par `await asyncio.to_thread(...)`
- Garder une référence forte sur toute `Task` et la nommer (`name=`) pour les traces
- Re-lever `CancelledError` après le cleanup, jamais l'avaler
- N'utiliser que les primitives `asyncio` (`Lock`, `Semaphore`, `Queue`) dans le code async

## À éviter
- `asyncio.get_event_loop()` — banni en `[tool.ruff.lint.flake8-tidy-imports.banned-api]`, la CI échoue
- `asyncio.gather` sans `return_exceptions=True` : les tâches sœurs continuent après une erreur
- `time.sleep`, appel HTTP synchrone ou parsing lourd directement dans une coroutine
- `threading.Lock` / `threading.Semaphore` en contexte async — ils bloquent le thread entier

## Gotchas
- Python 3.14 : `asyncio.get_event_loop()` lève `RuntimeError` hors loop au lieu d'en créer une
- `CancelledError` hérite de `BaseException` : `except Exception` ne l'attrape pas, un `except BaseException` mal placé casse l'annulation
- `TaskGroup` lève un `ExceptionGroup`, jamais l'exception nue : un `except ValueError` autour du bloc ne matche rien (cf. [gestion-erreurs.md](gestion-erreurs.md))
- `create_task` ne laisse qu'une référence faible côté loop : une task non référencée disparaît silencieusement
- `python -m asyncio pstree <PID>` (3.14) inspecte un loop figé sans instrumenter le process

## Exemples
```python
# ✅ pool borné, TaskGroup, timeout, handles relus après le bloc
sem = asyncio.Semaphore(3)

async def resolve(track):
    async with sem, asyncio.timeout(100):
        return await client.search(track)

async def run(tracks):
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(resolve(t), name=f"resolve:{t.id}") for t in tracks]
    return [t.result() for t in tasks]

# ❌ gèle l'event loop entier
async def write(path):
    save_tags(path)

# ✅
async def write(path):
    await asyncio.to_thread(save_tags, path)
```
