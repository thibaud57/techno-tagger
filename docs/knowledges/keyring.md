---
title: "keyring — Stockage de la clé API dans le Credential Manager"
version: "25.7.0"
description: "Référence technique pour keyring : API de base, backend Windows, forçage explicite du backend sous PyInstaller et gestion des erreurs."
date: "2026-08-29"
keywords: ["keyring", "credential-manager", "windows", "api-key", "pyinstaller", "backend"]
scope: ["docs"]
technologies: ["Python", "PyInstaller"]
---

# Description

Stocke la clé API de techno-scraper dans le **Credential Manager Windows**, plutôt qu'en clair dans un fichier de configuration ou dans le `store` Tauri (cf. [ADR-012](../adrs/012-securite-cle-api-keyring.md)).

Une clé par utilisateur, saisie dans les Settings, lue par le sidecar au moment de construire le client HTTP.

**Le piège central de cette dépendance est son interaction avec PyInstaller** : le mécanisme de découverte de backend ne survit pas à l'empaquetage, et l'échec ne se manifeste que dans le binaire distribué.

---

# Concepts Clés

## API de base

### Description

Trois fonctions et une clé composite `(service_name, username)`. Le projet n'ayant qu'un secret, `username` est une constante.

### Exemple

```python
import keyring

SERVICE = "techno-tagger"
USERNAME = "api-key"

keyring.set_password(SERVICE, USERNAME, value)
key = keyring.get_password(SERVICE, USERNAME)   # None si absent
keyring.delete_password(SERVICE, USERNAME)      # lève si absent
```

### Points Importants

- **`get_password` rend `None` pour une entrée absente**, sans lever : c'est le cas normal au premier lancement, pas une erreur
- **`delete_password` lève `PasswordDeleteError` si l'entrée n'existe pas** : l'envelopper pour rendre la suppression idempotente
- `set_password` écrase silencieusement une valeur existante pour le même couple
- `get_credential()` rend un objet avec `.username` et `.password`, utile si plusieurs identités devaient cohabiter — hors périmètre ici

---

## Backend Windows

### Description

`WinVaultKeyring` écrit dans le Credential Manager via `CredWrite`, en type générique.

### Exemple

```python
from keyring.backends.Windows import WinVaultKeyring

keyring.set_keyring(WinVaultKeyring())
```

### Points Importants

- **Limite de taille d'environ 2560 octets** (~1280 caractères UTF-16), imposée par l'API Windows et non par keyring. Sans conséquence pour une clé API, à garder en tête pour un token long
- Le backend écrit en UTF-16, avec un repli de lecture en UTF-8
- En cas de collision avec une entrée déjà stockée sous le nom de service brut, keyring déplace l'existante vers `{username}@{service}`
- Le secret est lisible par l'utilisateur Windows connecté : keyring protège d'un fichier en clair, pas d'un utilisateur malveillant sur sa propre session

---

## Forçage du backend sous PyInstaller

### Description

**C'est le point critique.** En fonctionnement normal, keyring découvre son backend par les entry points, ce qui suppose la présence des métadonnées `.dist-info`. PyInstaller ne les embarque pas : `entry_points()` rend une liste vide, keyring bascule sur son backend `fail`, et le premier appel lève `NoKeyringError`.

Le même code fonctionne parfaitement hors binaire, ce qui rend le diagnostic trompeur.

### Exemple

```python
# Au tout début du sidecar, avant tout accès au secret
import keyring
from keyring.backends.Windows import WinVaultKeyring

keyring.set_keyring(WinVaultKeyring())
```

### Points Importants

- **`set_keyring()` court-circuite entièrement la découverte** : c'est la solution confirmée par les mainteneurs, pas un contournement
- **Le hook livré par le paquet (`hook-keyring.backend.py`) ne suffit pas** : il ajoute des `hiddenimports` mais ne copie pas les métadonnées que la découverte lit
- **L'appel doit précéder toute utilisation** du secret, donc au démarrage du sidecar et non à la première lecture
- La variable d'environnement `PYTHON_KEYRING_BACKEND` est l'alternative sans modification de code, mais **moins fiable pour un sidecar** dont l'environnement est hérité du process parent, hors contrôle du code Python
- Symptôme à reconnaître : `No recommended backend was available` dans le binaire, jamais en développement

---

## Gestion des erreurs

### Description

Trois erreurs à distinguer, chacune avec une action différente côté interface.

### Exemple

```python
from keyring.errors import KeyringError, NoKeyringError, PasswordDeleteError, PasswordSetError

def store_api_key(value: str) -> None:
    try:
        keyring.set_password(SERVICE, USERNAME, value)
    except PasswordSetError as exc:
        raise SettingsError("api_key_not_stored") from exc
    except NoKeyringError as exc:
        raise SettingsError("keyring_unavailable") from exc

def clear_api_key() -> None:
    try:
        keyring.delete_password(SERVICE, USERNAME)
    except PasswordDeleteError:
        pass   # déjà absente, suppression idempotente
```

### Points Importants

- **`NoKeyringError` dans le binaire signale le problème d'empaquetage**, pas une panne système : ne pas la présenter à l'utilisateur comme « coffre-fort indisponible » sans avoir vérifié le forçage du backend
- `PasswordSetError` couvre le dépassement de taille
- Toutes héritent de `KeyringError` : une capture large est possible, mais le message utilisateur perd en précision
- **La clé ne doit jamais apparaître dans un log ni dans un event Sentry** (cf. [ADR-014](../adrs/014-observabilite-sentry-et-rgpd.md))

---

# Commandes Clés

## Diagnostic et manipulation manuelle

### Description

Le CLI sert au débogage local et à l'assistance à distance chez un utilisateur, pas au fonctionnement de l'application.

### Syntaxe

```bash
keyring diagnose                             # backend sélectionné et fichier de config
keyring set techno-tagger api-key            # saisie masquée
keyring get techno-tagger api-key            # affiche le secret en clair
keyring del techno-tagger api-key
```

### Points Importants

- **`keyring get` affiche le secret en clair sur la sortie standard** : à ne jamais lancer dans un terminal partagé ou une session enregistrée
- `keyring diagnose` est le premier réflexe quand le backend sélectionné est douteux
- **`keyring --disable` écrit une configuration persistante** qui désactive keyring pour l'utilisateur système : effet durable au-delà du process, à ne pas utiliser pour « tester »
- Ces commandes utilisent le keyring de l'environnement Python, pas celui du binaire empaqueté : elles valident le stockage, pas le packaging

---

# Bonnes Pratiques

## ✅ Recommandations

- **Appeler `keyring.set_keyring(WinVaultKeyring())` au démarrage du sidecar**, avant tout accès au secret
- **Tester la lecture de la clé dans le binaire PyInstaller**, pas seulement en développement : c'est le seul endroit où le bug se manifeste
- **Rendre `delete_password` idempotent** en capturant `PasswordDeleteError`
- **Traiter `get_password() is None` comme un état normal** : premier lancement, ou clé effacée par l'utilisateur
- **Nommer le service avec le nom de l'application** pour que l'entrée soit identifiable dans le Credential Manager
- **Vérifier la clé par un appel à `/health` puis une route authentifiée** plutôt que par sa forme : une clé bien formée peut être révoquée

## ❌ Anti-Patterns

- **Compter sur la découverte automatique du backend** dans un binaire gelé : elle échoue, et seulement là
- **Compter sur `PYTHON_KEYRING_BACKEND` pour un sidecar** : l'environnement est hérité du process parent
- **Stocker la clé dans le `store` Tauri ou dans un fichier de configuration** : c'est précisément ce que l'ADR-012 écarte
- **Logguer la clé, même tronquée**, ou la laisser passer dans un event Sentry
- **Capturer `Exception` autour des appels keyring** : `NoKeyringError` et `PasswordSetError` demandent des messages différents
- **Lancer `keyring --disable` pour déboguer** : la désactivation persiste pour l'utilisateur système

---

# 🔗 Ressources

## Documentation Officielle

- [keyring](https://keyring.readthedocs.io/en/latest/)
- [Historique des versions](https://keyring.readthedocs.io/en/latest/history.html)
- [Dépôt jaraco/keyring](https://github.com/jaraco/keyring)

## Ressources Complémentaires

- [ADR-012 — Sécurité de la clé API par keyring](../adrs/012-securite-cle-api-keyring.md)
- [Issue #399 — NoKeyringError sous PyInstaller](https://github.com/jaraco/keyring/issues/399)
- [Issue #468 — découverte des backends dans un binaire gelé](https://github.com/jaraco/keyring/issues/468)
- [pyinstaller.md](pyinstaller.md) — hooks et métadonnées
