---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python Gestion d'Erreurs & Logging — Règles

## À faire
- Dériver toutes les erreurs métier d'une exception de base par domaine, elle-même héritée d'`Exception`
- Porter le `code` stable et les `params` structurés en attributs de l'exception, jamais dans le message : c'est ce que sérialise l'événement `error` NDJSON, l'interface traduit (cf. [ARCHITECTURE.md § API](../../../docs/ARCHITECTURE.md#api))
- `raise MonErreur(...) from e` pour garder l'origine technique sous l'erreur métier, `from None` pour masquer un détail d'implémentation
- Un logger par module via `logging.getLogger(__name__)`, la configuration se faisant une seule fois au point d'entrée
- `logger.exception(...)` dans un `except` (traceback inclus), avec formatage lazy `%s`, pas de f-string
- Trier les erreurs d'un `TaskGroup` par `except*`, une clause par famille
- Rattacher un incident propre à un morceau à son `failure_reason`, pas à un message libre

## À éviter
- `except:` nu, et `except Exception` sans re-raise — masque `KeyboardInterrupt` et les bugs
- `print` pour du diagnostic : le binaire empaqueté n'a pas de console, et `stdout` porte le flux NDJSON
- `assert` pour valider une commande reçue sur `stdin` : supprimé sous `python -O`
- `return` / `break` / `continue` sortant d'un bloc `finally`
- Logger la clé API, un chemin complet ou un titre de morceau vers Sentry (cf. [PRODUCTION.md § Secrets & Configuration](../../../docs/PRODUCTION.md#secrets--configuration))

## Gotchas
- Toute écriture sur `stdout` autre qu'un événement NDJSON corrompt le protocole : diagnostics sur `stderr` et dans le fichier de log tournant
- PEP 765 (3.14) : un `return` dans `finally` déclenche un `SyntaxWarning` et avale silencieusement l'exception en vol
- PEP 758 (3.14) : `except A, B:` sans parenthèses est autorisé, mais elles redeviennent obligatoires avec `as`
- Un incident qui concerne un morceau sort en `track_resolved`, jamais aussi en `error` : les deux ensemble le compteraient deux fois
- `sentry_sdk.init()` peut échouer dans le binaire figé : l'entourer d'un `try/except`, une remontée cassée ne doit pas empêcher le démarrage

## Exemples
```python
# ✅ code stable + params structurés, traduits côté interface
class TaggerError(Exception):
    """Base de toutes les erreurs du sidecar."""

class FileLocked(TaggerError):
    def __init__(self, path: Path):
        super().__init__(f"file locked: {path}")
        self.code = "file_locked"
        self.params = {"path": str(path)}

try:
    write_tags(path)
except PermissionError as e:
    raise FileLocked(path) from e

# ❌ message destiné à l'écran, formaté côté Python
raise TaggerError(f"Impossible d'écrire {path}, fichier verrouillé")
```
