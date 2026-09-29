---
paths:
  - "sidecar/src/tagger/__main__.py"
  - "sidecar/src/tagger/scraper_client.py"
  - "sidecar/build.py"
---

# keyring — Stockage de la clé API

## À faire
- Appeler `keyring.set_keyring(WinVaultKeyring())` au tout début du sidecar : il court-circuite la découverte par entry points
- Nommer le service avec le nom de l'application et garder `username` constant : un seul secret, identifiable dans le Credential Manager
- Traiter `get_password() is None` comme un état normal : premier lancement, ou clé effacée par l'utilisateur
- Rendre la suppression idempotente en capturant `PasswordDeleteError`, que `delete_password` lève sur une entrée absente
- Mapper `PasswordSetError` et `NoKeyringError` sur des erreurs métier distinctes : le message utilisateur n'est pas le même
- Ne valider une clé que par un contrôle de saisie : sa validité se prouve à l'usage, par la garde des trois 403
- Tester la lecture du secret sur le binaire PyInstaller : c'est le seul endroit où le bug se manifeste

## À éviter
- Compter sur la découverte automatique du backend dans un binaire gelé : elle échoue, et seulement là
- Compter sur `PYTHON_KEYRING_BACKEND` pour le sidecar : son environnement est hérité du process parent, hors contrôle du code Python
- Stocker la clé dans le `store` Tauri ou un fichier de configuration (cf. [ADR-012](../../../docs/adrs/012-securite-cle-api-keyring.md))
- Logguer la clé, même tronquée, ou la laisser passer dans un event Sentry (cf. [ADR-014](../../../docs/adrs/014-observabilite-sentry-et-rgpd.md))
- Capturer `Exception` autour des appels keyring : `NoKeyringError` et `PasswordSetError` demandent des messages différents
- `keyring --disable` pour déboguer : persistant, il désactive keyring pour tout l'utilisateur
- `keyring get` dans un terminal partagé ou une session enregistrée : le secret s'affiche en clair

## Gotchas
- Depuis 12.0.0, les backends ne sont découverts que par entry points : sans hook, le binaire figé lève `NoKeyringError` (`No recommended backend was available`), jamais en développement
- `hook-keyring.py` de PyInstaller résout le backend (`collect_submodules`) et copie les métadonnées ; le `.spec` double volontairement ce `copy_metadata`. Les `--hidden-import win32ctypes.pywin32.win32cred` et `win32ctypes.pywin32.pywintypes` restent indispensables
- Le `hook-keyring.backend.py` du dépôt GitHub de keyring n'est découvert par personne : ne pas s'y fier
- Le Credential Manager plafonne à 2560 octets : au-delà, `CredWrite ... (1783, "The stub received bad data")`, remonté en `PasswordSetError`
- Le secret est lisible par l'utilisateur Windows connecté : keyring protège d'un fichier en clair, pas d'un utilisateur malveillant sur sa propre session
- 25.3.0 déprécie les `username` vides. La dépendance est `pywin32-ctypes`, pure Python, donc sans extension compilée à empaqueter

## Exemples
```python
# ✅ forçage du backend au démarrage, avant tout accès
keyring.set_keyring(WinVaultKeyring())

# ✅ erreurs distinguées, suppression idempotente
try:
    keyring.set_password(SERVICE, USERNAME, value)
except PasswordSetError as exc:
    raise SettingsError("api_key_not_stored") from exc
except NoKeyringError as exc:
    raise SettingsError("keyring_unavailable") from exc

try:
    keyring.delete_password(SERVICE, USERNAME)
except PasswordDeleteError:
    pass

# ❌ découverte laissée à keyring dans le binaire
key = keyring.get_password(SERVICE, USERNAME)
```
