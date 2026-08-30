---
title: "ADR-012 — Sécurité de la clé API : keyring et clé par utilisateur"
status: "accepted"
description: "La clé X-API-Key vit dans le sidecar Python et est stockée dans le trousseau de l'OS via keyring, avec une clé distincte et révocable par utilisateur."
date: "2026-08-02"
keywords: ["architecture", "adr", "securite", "keyring", "api-key", "stronghold"]
scope: ["docs", "architecture"]
technologies: ["keyring", "Python", "Tauri", "Windows Credential Manager"]
---

# 🎯 Contexte

L'application appelle techno-scraper avec un header `X-API-Key`. Elle est distribuée à quelques amis DJ sous forme d'un installeur Windows.

Deux questions distinctes se posent : où stocker la clé sur la machine, et faut-il une clé unique partagée ou une clé par personne.

---

# 🧩 Problème

Comment stocker la clé API sans qu'elle transite par la webview ni ne se retrouve extractible du binaire distribué, et selon quel modèle la distribuer ?

---

# 🛠️ Options Envisagées

## Option A : keyring côté Python, une clé par utilisateur

**Description :** Chaque utilisateur saisit sa propre clé dans les Settings. Le sidecar la range dans le trousseau de l'OS via **keyring** et ne la renvoie jamais à l'interface.

**Avantages :**
- **La clé ne touche jamais le JavaScript de la webview** : elle est saisie, transmise une fois au sidecar par la commande `set_api_key`, puis vit exclusivement côté Python
- keyring parle nativement au Credential Manager Windows et au Keychain macOS, donc chiffrement délégué à l'OS
- Une clé compromise se révoque **individuellement**, sans rediffuser l'application
- Le binaire distribué ne contient aucun secret

**Inconvénients :**
- Chaque utilisateur doit recevoir et saisir une clé, ce qui est une friction au premier lancement
- Impose une gestion de clés côté techno-scraper, qui n'en compare aujourd'hui qu'une seule
- keyring est une dépendance native de plus à empaqueter avec PyInstaller

**Coût estimé :** Faible côté application, non nul côté API (cf. [ADR-016](016-multi-cles-techno-scraper.md)).

## Option B : Plugin Tauri Stronghold

**Description :** Stocker la clé via le plugin de coffre chiffré de Tauri, côté Rust, et la transmettre au sidecar à chaque besoin.

**Avantages :**
- Solution intégrée à l'écosystème Tauri, chiffrement fort et portable
- Un seul mécanisme de stockage pour tous les secrets de l'application

**Inconvénients :**
- **La clé transiterait par le JavaScript de la webview**, ce qui annulerait exactement le bénéfice recherché
- Un coffre applicatif à déverrouiller, là où le trousseau de l'OS est déjà déverrouillé par la session
- keyring couvre déjà le besoin nativement, sans code Rust

**Coût estimé :** Équivalent, pour un modèle de menace moins bon.

## Option C : Clé unique partagée, compilée dans le binaire

**Description :** Une seule clé pour tout le monde, embarquée au build.

**Avantages :**
- Aucune friction : l'application marche dès l'installation, rien à saisir
- Aucune gestion de clés côté API

**Inconvénients :**
- **Une clé compilée dans un binaire est extractible**, un `strings` suffit sur un exécutable PyInstaller
- La révoquer obligerait à **rediffuser l'application à tout le monde**
- Aucun moyen de couper l'accès à une seule personne, ni de savoir qui consomme quoi

**Coût estimé :** Nul immédiatement, rédhibitoire au premier incident.

---

# 🎉 Décision

**keyring côté Python, une clé distincte par utilisateur, saisie dans les Settings.**

Le choix du stockage découle du modèle de menace : le bénéfice recherché est que la clé ne soit jamais manipulable depuis le contexte JavaScript de la webview. Stronghold, en la faisant passer par le JavaScript pour l'envoyer au sidecar, annulerait ce bénéfice.

Le choix du modèle de distribution découle du coût de la révocation. Une clé partagée compilée dans le binaire est extractible par construction, et sa révocation punit tout le monde.

---

# 🔄 Conséquences

## Positives

- La clé est chiffrée par le Credential Manager Windows, sans code de chiffrement à écrire ni à auditer
- Elle n'apparaît ni dans le protocole NDJSON (hors la commande de saisie), ni dans les logs, ni dans les rapports, ni dans les payloads Sentry
- Une clé compromise se révoque pour une seule personne, sans rediffusion
- Le binaire distribué ne contient aucun secret, ce qui rend le dépôt public sans risque de fuite (cf. [ADR-021](021-visibilite-du-depot.md))

## Négatives

- Friction au premier lancement : sans clé, l'application ne fait rien, et l'écran de Settings doit le dire clairement
- Une clé à générer, transmettre et suivre pour chaque nouvel utilisateur, à la main
- **techno-scraper compare aujourd'hui contre une clé unique** et doit passer à un jeu de clés nommées, sur une API déjà en production
- keyring est une dépendance native, avec les complications de packaging PyInstaller associées

---

# 📝 Notes complémentaires

Un test de sécurité vérifie explicitement que la clé n'apparaît ni dans les logs, ni dans les rapports, ni dans les payloads Sentry.

> 🔴 **« Complications de packaging » est un euphémisme : keyring échoue par défaut sous PyInstaller.** Ses backends sont découverts par entry points, que l'analyse statique de PyInstaller ne voit pas, si bien que le binaire empaqueté lève `No recommended backend was available` là où le mode développement fonctionne ([keyring#468](https://github.com/jaraco/keyring/issues/468), [keyring#399](https://github.com/jaraco/keyring/issues/399)). **Un hidden import ne suffit pas** : c'est la découverte par entry points qu'il faut réparer, donc `--collect-metadata keyring` en plus des hidden imports `win32ctypes.pywin32.win32cred` et `pywintypes`. Le plus sûr reste de court-circuiter la découverte en forçant le backend, par `PYTHON_KEYRING_BACKEND` ou `keyring.set_keyring()`. L'enregistrement d'une clé se valide ensuite **depuis le bundle**, jamais depuis les sources. Sans stockage de clé, l'application ne fait rien : le défaut est total, et invisible jusqu'au premier build empaqueté.

Le passage de techno-scraper à un jeu de clés nommées est traité séparément (cf. [ADR-016](016-multi-cles-techno-scraper.md)), et conditionne le nombre d'utilisateurs réellement gérable.

L'URL de l'API est également configurable dans les Settings, mais elle n'est pas un secret : elle est publique et de toute façon présente en clair dans le binaire distribué.
