---
title: "ADR-001 — Coquille desktop : Tauri v2"
status: "accepted"
description: "Choix de Tauri v2 comme coquille desktop, contre Electron, pour une application dont tout le métier vit dans un sidecar Python."
date: "2026-08-02"
keywords: ["architecture", "adr", "desktop", "tauri", "electron", "packaging"]
scope: ["docs", "architecture"]
technologies: ["Tauri", "Electron", "Rust"]
---

# 🎯 Contexte

L'outil existe en CLI Python utilisable par son seul auteur. Le projet consiste à en faire une application distribuable à quelques amis DJ, avec une interface graphique.

Le métier reste en Python : mutagen a des années d'avance sur le parsing des tags audio et de leurs cas tordus, et le code CLI existant est réutilisable. La coquille desktop n'a donc qu'un rôle de contenant : afficher une webview, lancer un process natif, ouvrir des sélecteurs de dossiers, empaqueter et mettre à jour.

---

# 🧩 Problème

Quelle coquille desktop retenir pour héberger une interface web et un process natif Python, sachant qu'aucune logique métier ne vivra dans la coquille elle-même ?

---

# 🛠️ Options Envisagées

## Option A : Tauri v2

**Description :** Coquille Rust utilisant la webview système (WebView2 sur Windows), avec un système de plugins pour les capacités natives et un mécanisme de sidecar pour embarquer un binaire tiers.

**Avantages :**
- Utilise la webview du système, aucun moteur de rendu embarqué : bundles de quelques mégaoctets
- `Command.sidecar()` est prévu exactement pour ce cas d'usage, le binaire PyInstaller s'embarque via `bundle.externalBin`
- Modèle de permissions explicite : le plugin `shell` n'autorise que le sidecar déclaré, pas de commande arbitraire
- Updater signé fourni par le framework, avec vérification cryptographique du bundle
- Aucune raison d'embarquer un runtime Node puisque le métier est en Python

**Inconvénients :**
- Impose une chaîne de compilation Rust en développement et en CI
- La webview système varie selon la machine, un rendu peut différer d'un poste à l'autre
- Le binaire du sidecar doit porter le suffixe target-triple (`tagger-x86_64-pc-windows-msvc.exe`), Tauri refuse de bundler sans

**Coût estimé :** Faible. Le Rust se limite à l'initialisation des plugins dans `src-tauri/src/lib.rs`.

## Option B : Electron

**Description :** Coquille Node.js embarquant Chromium, écosystème mature de packaging et de mise à jour.

**Avantages :**
- Rendu identique partout, Chromium étant embarqué
- Écosystème très large, beaucoup de recettes disponibles pour le packaging et l'auto-update
- Pas de chaîne Rust à installer

**Inconvénients :**
- Embarque Chromium **et** Node pour une application dont tout le métier est en Python : deux runtimes de trop, l'un pour rien
- Bundles de l'ordre de 100 à 150 Mo contre quelques mégaoctets
- Aucun modèle de permissions comparable : le process principal a accès à tout Node, y compris `child_process`
- L'empreinte mémoire d'un Chromium complet est démesurée pour trois écrans

**Coût estimé :** Faible en effort, élevé en poids distribué.

---

# 🎉 Décision

**Tauri v2.**

La logique métier étant intégralement en Python, la coquille n'a besoin que de trois choses : lancer un process, ouvrir des dialogues natifs, empaqueter et mettre à jour. Tauri fait exactement cela, Electron ferait la même chose en embarquant deux runtimes inutiles.

Le mécanisme de sidecar est déterminant : il transforme le binaire PyInstaller en dépendance déclarée du bundle, sans manipulation de chemins ni installation séparée chez l'utilisateur.

Le Rust reste une zone morte : `src-tauri/src/lib.rs` se limite à l'initialisation des plugins, et on n'y retourne pas.

---

# 🔄 Conséquences

## Positives

- Installeur Windows léger, téléchargement rapide chez des utilisateurs non techniques
- Le modèle de permissions Tauri permet de n'accorder que le lancement du sidecar et le périmètre `fs` réellement nécessaire
- L'updater signé est fourni, avec vérification cryptographique gratuite
- Aucune dépendance Node à l'exécution

## Négatives

- Une chaîne Rust à installer en développement et à provisionner en CI, pour du code qu'on n'écrit pas
- Le rendu dépend de la version de WebView2 présente sur la machine
- Le suffixe target-triple du binaire sidecar est un piège au premier build, il faut le poser dans le script de build PyInstaller
- Écosystème plus jeune qu'Electron : moins de recettes toutes faites pour les cas tordus

---

# 📝 Notes complémentaires

Le choix de la coquille ne conditionne pas le métier : le sidecar communique par flux standard (cf. [ADR-005](005-sidecar-python-protocole-ndjson.md)), et resterait utilisable tel quel derrière une autre coquille, voire en ligne de commande.

Références : [Tauri v2 — Sidecar](https://v2.tauri.app/develop/sidecar/), [Tauri v2 — Plugins](https://v2.tauri.app/plugin/).
