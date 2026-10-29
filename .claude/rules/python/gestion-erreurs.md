---
paths:
  - "sidecar/src/tagger/**/*.py"
---

# Python : gestion d'erreurs et logging

## À faire
- Dériver toutes les erreurs métier d'une exception de base par domaine, elle-même héritée d'`Exception`
- Porter le `code` stable et les `params` en attributs de l'exception, jamais dans le message : l'événement `error` les sérialise, l'interface traduit
- `raise MonErreur(...) from None` pour masquer un détail d'implémentation, `from e` sinon : B904 impose l'un des deux dans un `except`
- Un logger par module via `logging.getLogger(__name__)`, la configuration se faisant une seule fois au point d'entrée
- Trier les erreurs d'un `TaskGroup` par `except*`, une clause par famille : plusieurs clauses peuvent s'exécuter pour un même groupe et `except*` ne se mélange pas avec un `except` classique dans le même `try`
- Structurer les logs en logfmt avec le jeu de clés fixe (`run`, `track`, `source`, `score`, `status`, `reason`, `request_id`, `errno`) : une clé inventée fausse un `grep` sans que rien ne casse
- Rattacher un incident propre à un morceau à son `failure_reason`, pas à un message libre

## À éviter
- Logger la clé API, un chemin complet ou un titre de morceau vers Sentry (cf. [PRODUCTION.md § Secrets & Configuration](../../../docs/PRODUCTION.md#secrets--configuration))

## Gotchas
- Toute écriture sur `stdout` autre qu'un événement NDJSON corrompt le protocole : diagnostics sur `stderr` et dans le fichier de log tournant
- PEP 758 (3.14) : `except A, B:` sans parenthèses est autorisé, mais elles redeviennent obligatoires avec `as`
- Un incident qui concerne un morceau sort en `track_resolved`, jamais aussi en `error` : les deux ensemble le compteraient deux fois

## Exemples
```python
# ✅ code stable + params structurés, traduits côté interface
class TaggerError(Exception):
    """Base de toutes les erreurs du sidecar."""

class FileLockedError(TaggerError):
    def __init__(self, path: Path):
        super().__init__(f"file locked: {path}")
        self.code = "file_locked"
        self.params = {"path": str(path)}

try:
    write_tags(path)
except PermissionError as e:
    raise FileLockedError(path) from e

# ❌ message destiné à l'écran, formaté côté Python
raise TaggerError(f"Impossible d'écrire {path}, fichier verrouillé")
```
