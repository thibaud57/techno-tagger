---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python : asyncio

## À faire
- Entrer par `asyncio.run(main())`, une seule fois ; `asyncio.get_running_loop()` si une référence au loop est nécessaire
- Lancer les tâches concurrentes avec `asyncio.TaskGroup` et lire les résultats via les handles après le bloc
- Borner la concurrence par un `asyncio.Semaphore` par source, aux tailles fixées par [ARCHITECTURE.md § Concurrence](../../../docs/ARCHITECTURE.md#concurrence) ; le pool des pochettes est distinct de celui des sources
- Poser un `asyncio.timeout(...)` sur un enchaînement d'étapes, au-dessus du budget de l'API pour recevoir son 504 structuré ; le timeout par requête vit sur le client HTTP (cf. [httpx2/client.md](../httpx2/client.md))
- Déléguer tout appel bloquant (mutagen, sqlite3, keyring, système de fichiers) par `await asyncio.to_thread(...)`
- Nommer toute `Task` (`name=`) pour les traces : la référence forte est imposée par RUF006
- Re-lever `CancelledError` après le cleanup, jamais l'avaler et garder ce cleanup court : un `await` long y retarde l'annulation
- Protéger par `asyncio.shield(...)` une opération qui doit aller à son terme malgré l'annulation de l'appelant (écriture d'un cache, d'un dump)

## À éviter
- `asyncio.gather` sans `return_exceptions=True` : les tâches sœurs continuent après une erreur
- Un parsing lourd directement dans une coroutine : il gèle l'event loop comme un appel bloquant
- `threading.Lock` / `threading.Semaphore` en contexte async : ils bloquent le thread entier, seules les primitives `asyncio` (`Lock`, `Semaphore`, `Queue`) conviennent

## Gotchas
- `CancelledError` hérite de `BaseException` : `except Exception` ne l'attrape pas, un `except BaseException` mal placé casse l'annulation
- `TaskGroup` lève un `ExceptionGroup`, jamais l'exception nue : un `except ValueError` autour du bloc ne matche rien (cf. [gestion-erreurs.md](gestion-erreurs.md))
- `python -m asyncio pstree <PID>` (3.14) inspecte un loop figé sans instrumenter le process et `PYTHONASYNCIODEBUG=1` signale les coroutines jamais attendues et les callbacks lents
- `asyncio.shield` protège la coroutine, pas l'appelant : celui-ci reçoit quand même `CancelledError` pendant que l'opération protégée continue

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
