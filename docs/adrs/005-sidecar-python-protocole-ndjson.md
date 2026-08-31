---
title: "ADR-005 — Métier en sidecar Python et protocole NDJSON"
status: "accepted"
description: "Le métier reste en Python dans un sidecar lancé en process long, communiquant avec l'interface par commandes JSON sur stdin et événements NDJSON sur stdout."
date: "2026-08-27"
keywords: ["architecture", "adr", "sidecar", "ndjson", "python", "rust", "protocole"]
scope: ["docs", "architecture"]
technologies: ["Python", "Rust", "Tauri", "mutagen", "PyInstaller"]
---

# 🎯 Contexte

Le métier existe déjà en Python dans la CLI `BeatportScrapper-TrackTagger` : parsing des playlists, déplacement de fichiers, lecture et écriture des tags, matching. La coquille retenue est Tauri, donc Rust (cf. [ADR-001](001-coquille-desktop-tauri.md)).

Deux besoins du MVP contraignent la frontière entre l'interface et le métier :

- une barre de progression qui avance pendant le traitement de 100 morceaux ;
- un pipeline qui continue de tourner pendant qu'une modale d'arbitrage attend une décision humaine.

---

# 🧩 Problème

Dans quel langage écrire le métier, et sous quelle forme le faire dialoguer avec l'interface ?

---

# 🛠️ Options Envisagées

## Option A : Sidecar Python en process long, protocole NDJSON bidirectionnel

**Description :** Un binaire PyInstaller lancé au démarrage de l'application et maintenu vivant. L'interface lui envoie des commandes JSON ligne par ligne sur `stdin`, il émet un flux d'événements NDJSON sur `stdout`.

**Avantages :**
- **mutagen** reste disponible : pur Python, sans dépendance hors bibliothèque standard, couvrant les quatre formats retenus, WAV compris, avec des années de maturité sur les cas tordus
- Le code CLI existant est réutilisable tel quel
- Le flux d'événements donne la progression et l'arbitrage asynchrone sans mécanisme supplémentaire
- La frontière devient une petite API **testable en ligne de commande sans interface**, en injectant des commandes sur `stdin`
- Le pipeline garde son état en mémoire entre deux commandes : la file d'arbitrage, le pool asyncio et le plan de run vivent dans un seul process

**Inconvénients :**
- Un protocole à concevoir, versionner et maintenir en double (modèles Python et types TypeScript miroir)
- Un process à surveiller : redémarrage si le sidecar tombe, gestion de la fermeture propre de l'application
- Le binaire PyInstaller doit porter le suffixe target-triple, et PyInstaller ne cross-compile pas

**Coût estimé :** Moyen. Le protocole est l'étape 3 de l'ordre de développement, à figer avant d'écrire du TypeScript contre lui.

## Option B : Réécriture du métier en Rust dans la coquille Tauri

**Description :** Porter le parsing, le matching et l'écriture des tags en Rust, appelés par `invoke()` depuis l'interface.

**Avantages :**
- Un seul langage, un seul binaire, aucun protocole ni process à gérer
- Distribution plus simple, pas de PyInstaller
- Performances supérieures, sans intérêt réel ici puisque le facteur limitant est le réseau

**Inconvénients :**
- **L'écriture des tags audio est le point dur** : mutagen a des années d'avance sur les cas tordus (chunks ID3 dans les RIFF/WAVE, encodages hérités, frames mal formées). Les équivalents Rust couvrent moins de cas.
- Jette le code CLI existant, qui est la référence fonctionnelle du projet
- Transforme `src-tauri/src/` en zone vivante, à l'opposé du principe retenu
- Le métier ne serait plus testable indépendamment de la coquille

**Coût estimé :** Élevé, pour un gain nul sur le facteur limitant.

## Option C : Sidecar Python invoqué à la demande, une exécution par action

**Description :** Lancer le binaire Python à chaque action, récupérer sa sortie, le laisser mourir.

**Avantages :**
- Aucun process à surveiller, aucune gestion de cycle de vie
- Modèle mental simple : une commande, une sortie

**Inconvénients :**
- **Ne permet pas la progression en continu** : la sortie n'arrive qu'à la fin
- **Ne permet pas l'arbitrage asynchrone** : impossible de continuer le pipeline pendant qu'une modale attend
- L'état (file d'arbitrage, pool, plan) devrait être resérialisé et rechargé à chaque invocation
- Coût de démarrage d'un binaire PyInstaller payé à chaque action

**Coût estimé :** Faible à l'écriture, rédhibitoire fonctionnellement.

---

# 🎉 Décision

**Sidecar Python en process long, protocole NDJSON bidirectionnel sur les flux standard.**

Le choix du langage est dicté par mutagen : écrire correctement les tags de quatre formats, WAV compris, est précisément le travail que ce projet ne veut pas refaire.

Le choix du process long est dicté par les deux besoins du MVP. La progression impose déjà un flux d'événements ; une fois ce flux en place, laisser le pipeline tourner pendant un arbitrage ne coûte que quelques dizaines de lignes.

Le protocole est traité comme une petite API, pas comme un détail d'implémentation : il est figé à l'étape 3, avant l'écriture du TypeScript qui le consomme.

---

# 🔄 Conséquences

## Positives

- Le métier est débogable en ligne de commande, sans lancer l'application, tout au long du développement
- L'interface devient remplaçable sans toucher au métier
- La clé API vit dans le process Python et ne touche jamais le JavaScript de la webview (cf. [ADR-012](012-securite-cle-api-keyring.md))
- Le pipeline conserve son état en mémoire, ce qui rend la file d'arbitrage et le pool asyncio triviaux

## Négatives

- Le contrat est maintenu en double : modèles dans `protocol.py`, types TypeScript miroir dans `core/models/`, sans génération de code
- Cycle de vie du process à gérer : détection de mort, redémarrage, fermeture propre, y compris quand l'utilisateur ferme la fenêtre pendant un run
- PyInstaller ne cross-compile pas, chaque plateforme cible impose son runner CI (cf. [ADR-015](015-cibles-distribution-windows.md))
- Un protocole mal figé au départ coûterait cher à faire évoluer une fois l'interface écrite contre lui

---

# 📝 Notes complémentaires

Les types TypeScript sont maintenus à la main plutôt que générés : le contrat compte une vingtaine de types et se stabilise à l'étape 3, une chaîne de génération coûterait plus cher qu'elle ne rapporte.

Le protocole ne transporte aucun secret : la clé API n'apparaît ni dans les commandes, ni dans les événements. Les Settings envoient `set_api_key`, le sidecar la range dans le trousseau et ne la renvoie jamais.

> 🔴 **Le streaming ligne à ligne exige un flush explicite une fois le sidecar empaqueté.** Un binaire PyInstaller lancé par un parent via un pipe, donc sans TTY, **ne respecte ni `-u` ni `PYTHONUNBUFFERED`** ([pyinstaller#8426](https://github.com/pyinstaller/pyinstaller/issues/8426)), et le `-u` du bootloader reste inopérant sur Windows, bootloader et DLL Python étant liés à des runtimes C distincts ([pyinstaller#1441](https://github.com/pyinstaller/pyinstaller/issues/1441)). Sans `flush=True` à chaque événement émis, progression et demandes d'arbitrage restent dans le buffer jusqu'à la fin du run, et l'interface paraît figée. Le défaut ne se manifeste **jamais** en `tauri dev`, où le sidecar tourne depuis les sources.
>
> **Vérifié empiriquement le 2026-08-27** sur un prototype embarquant les dépendances réelles, lancé par un parent via un pipe : sans `flush=True`, la première ligne n'arrive qu'à la **terminaison du process**, avec un retard égal à la durée d'exécution restante (3 s de traitement simulé → 3 s de retard, dans les deux modes de packaging). Avec `flush=True`, elle arrive au démarrage. Sur un run réel de 100 morceaux, l'interface resterait donc figée du début à la fin.
