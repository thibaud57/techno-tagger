---
paths:
  - "sidecar/src/tagger/__main__.py"
  - "sidecar/src/tagger/scraper_client.py"
  - "sidecar/build.py"
---

# keyring — Stockage de la clé API

## À faire
- Appeler `keyring.set_keyring(WinVaultKeyring())` au tout début du sidecar, avant tout accès au secret : `set_keyring()` court-circuite la découverte par entry points, c'est la solution confirmée par les mainteneurs et non un contournement
- Nommer le service avec le nom de l'application et garder `username` constant : le projet n'a qu'un secret, et l'entrée doit être identifiable dans le Credential Manager
- Traiter `get_password() is None` comme un état normal : premier lancement, ou clé effacée par l'utilisateur
- Rendre la suppression idempotente en capturant `PasswordDeleteError`, que `delete_password` lève sur une entrée absente
- Mapper `PasswordSetError` et `NoKeyringError` sur des erreurs métier distinctes : le message utilisateur n'est pas le même
- Valider une clé par un appel à `/health` puis à une route authentifiée, jamais par sa forme : une clé bien formée peut être révoquée
- Tester la lecture du secret sur le binaire PyInstaller, jamais seulement sur les sources : c'est le seul endroit où le bug se manifeste

## À éviter
- Compter sur la découverte automatique du backend dans un binaire gelé : elle échoue, et seulement là
- Compter sur `PYTHON_KEYRING_BACKEND` pour le sidecar : son environnement est hérité du process parent, hors contrôle du code Python
- Stocker la clé dans le `store` Tauri ou dans un fichier de configuration : c'est précisément ce que l'[ADR-012](../../../docs/adrs/012-securite-cle-api-keyring.md) écarte
- Logguer la clé, même tronquée, ou la laisser passer dans un event Sentry (cf. [ADR-014](../../../docs/adrs/014-observabilite-sentry-et-rgpd.md))
- Capturer `Exception` autour des appels keyring : `NoKeyringError` et `PasswordSetError` demandent des messages différents
- `keyring --disable` pour déboguer : la configuration est persistante et désactive keyring pour l'utilisateur système, bien au-delà du process
- `keyring get` dans un terminal partagé ou une session enregistrée : le secret s'affiche en clair

## Gotchas
- Depuis la 12.0.0 les backends sont découverts exclusivement par entry points, que PyInstaller n'embarque pas : `entry_points()` rend une liste vide, keyring bascule sur son backend `fail` et lève `NoKeyringError` (`No recommended backend was available`) dans le binaire, jamais en développement
- Le hook `hook-keyring.backend.py` livré par le paquet ne suffit pas : il ajoute des `hiddenimports` mais ne copie pas les métadonnées que lit la découverte. PyInstaller 6.22.2 en livre un second, `hook-keyring.py`, qui fait à la fois `collect_submodules("keyring.backends")` — c'est **lui** qui résout le backend — et `copy_metadata("keyring")`. Le `.spec` du projet garde la copie des métadonnées en double, volontairement : une régression du hook se verrait sinon uniquement dans le binaire. Les `--hidden-import win32ctypes.pywin32.win32cred` / `win32ctypes.pywin32.pywintypes` restent indispensables, `hook-win32ctypes.core.py` ne couvrant que `win32ctypes.core.*`
- Le Credential Manager plafonne à 2560 octets (`CRED_MAX_CREDENTIAL_BLOB_SIZE`) : un dépassement produit un `CredWrite ... (1783, "The stub received bad data")` cryptique, remonté en `PasswordSetError`
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
