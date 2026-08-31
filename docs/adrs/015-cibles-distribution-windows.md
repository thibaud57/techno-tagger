---
title: "ADR-015 — Cibles de distribution : Windows seul au MVP"
status: "accepted"
description: "Le MVP ne cible que Windows, macOS et Linux étant repoussés en Post-MVP en raison du coût de la notarisation Apple et de l'absence de cross-compilation PyInstaller."
date: "2026-08-27"
keywords: ["architecture", "adr", "distribution", "windows", "macos", "linux", "pyinstaller", "notarisation"]
scope: ["docs", "architecture"]
technologies: ["PyInstaller", "Tauri", "GitHub Actions"]
---

# 🎯 Contexte

L'application embarque un binaire Python produit par PyInstaller, qui **ne cross-compile pas** : chaque plateforme cible impose son propre runner en CI et son propre build à maintenir.

Le budget mensuel du projet est nul. Aucun utilisateur macOS n'est confirmé à ce jour.

---

# 🧩 Problème

Quelles plateformes cibler au MVP, sachant que chacune ajoute une chaîne de build complète et, pour macOS, une dépense annuelle ?

---

# 🛠️ Options Envisagées

## Option A : Windows seul au MVP

**Description :** Un seul runner, un seul build PyInstaller, un seul installeur. macOS et Linux repoussés en Post-MVP.

**Avantages :**
- **Le packaging est le vrai coût du projet, et le limiter à une cible le rend indolore**
- Aucune dépense : pas d'Apple Developer Program
- Un seul installeur à tester, une seule chaîne de signature à mettre en place
- Correspond aux utilisateurs réels connus à ce jour

**Inconvénients :**
- Un ami sur Mac serait exclu jusqu'à ce que la cible arrive
- Des hypothèses spécifiques à Windows peuvent s'installer dans le code sans qu'on s'en aperçoive (séparateurs de chemins, Credential Manager, comportement du trousseau)

**Coût estimé :** Le plus bas possible.

## Option B : Windows et macOS dès le MVP

**Description :** Deux runners, deux builds PyInstaller, notarisation Apple.

**Avantages :**
- Couvre l'ensemble probable des amis DJ dès la première distribution
- Force la portabilité du code dès le départ

**Inconvénients :**
- **Apple Developer Program à 99 $/an**, contre un budget nul
- Sans notarisation, l'application se distribue quand même mais **Gatekeeper la bloque au premier lancement**. Depuis macOS Sequoia, le contournement par Contrôle-clic ne suffit plus à cette première ouverture : l'utilisateur doit aller dans Réglages Système > Confidentialité et sécurité, trouver l'application, choisir « Ouvrir quand même » et s'authentifier comme administrateur. Les lancements suivants redeviennent normaux.
- Le compte Apple gratuit ne résout rien : ses certificats sont limités au développement local et ne permettent pas la notarisation
- Runner macOS **facturé x10** sur un dépôt privé
- Un second build PyInstaller à maintenir, avec sa maturité propre à vérifier

**Coût estimé :** 99 $/an, plus du temps de CI et de mise au point.

## Option C : Windows et Linux dès le MVP

**Description :** Ajouter Linux, qui n'exige aucune signature.

**Avantages :**
- Runner GitHub gratuit, aucune signature exigée, **indolore par comparaison à macOS**
- Force un minimum de portabilité

**Inconvénients :**
- Aucun utilisateur Linux, ni actuel ni pressenti
- Un second build PyInstaller et un second format d'installeur à tester, pour personne
- Le trousseau via keyring se comporte différemment selon l'environnement de bureau

**Coût estimé :** Faible en argent, non nul en temps, pour zéro utilisateur.

---

# 🎉 Décision

**Windows seul au MVP.**

Le packaging est le poste de coût réel de ce projet, pas le code. Le réduire à une cible le fait pratiquement disparaître, et permet de concentrer l'effort sur le métier.

macOS n'est pas repoussé par difficulté technique mais par arbitrage économique : la cible coûte à elle seule 99 $/an et un second build PyInstaller, pour **aucun utilisateur confirmé**. Elle reviendra au programme le jour où un ami sur Mac se manifeste réellement.

Linux est indolore mais sans destinataire ; il suivra macOS si l'occasion se présente.

Le mode PyInstaller retenu pour cette cible Windows est `--onedir`, détaillé en Notes complémentaires : mesuré plus rapide au démarrage et moins sujet aux faux positifs antivirus que `--onefile`.

---

# 🔄 Conséquences

## Positives

- Une seule chaîne de build, un seul installeur, une seule signature à mettre en place
- Aucune dépense, budget nul respecté
- Le premier build, seul moment coûteux, est passé tôt dans l'ordre de développement (étape 4)
- L'avertissement SmartScreen sur installeur non signé se contourne en deux clics dans la fenêtre elle-même, là où Gatekeeper envoie l'utilisateur dans les Réglages Système

## Négatives

- Un ami sur Mac est exclu jusqu'à nouvel ordre
- Des hypothèses Windows peuvent s'installer sans être détectées, et le portage ultérieur les révélera toutes d'un coup
- La maturité de PyInstaller sur macOS n'est pas vérifiée, ce travail reste entier
- Le suffixe target-triple du binaire (`tagger-x86_64-pc-windows-msvc.exe`) est codé pour une seule cible et devra devenir une matrice

---

# 📝 Notes complémentaires

Le dépôt étant public (cf. [ADR-021](021-visibilite-du-depot.md)), le runner macOS est **gratuit et sans plafond de minutes**, ce qui retire l'objection du coût de CI et ne laisse que la notarisation en travers. Reste à traiter le jour venu : maturité de PyInstaller sur cette plateforme et arbitrage sur les 99 $/an.

Le tarif des runners a par ailleurs baissé le 1er janvier 2026 (Linux x86 de 0,008 à 0,006 $/min, Windows de 0,016 à 0,010, macOS de 0,080 à 0,062), mais cela ne concerne que les dépôts privés.

L'installeur Windows n'est pas signé : SmartScreen affichera un avertissement au premier lancement, contournable en deux clics.

Signer n'y changerait d'ailleurs pas grand-chose. **Depuis mars 2024, les certificats EV n'ont plus de contournement SmartScreen instantané** : EV comme OV construisent leur réputation par volume de téléchargements, volume qu'une application distribuée à quelques amis n'atteindra jamais. L'avertissement resterait donc malgré la dépense. Les certificats EV sont par ailleurs réservés aux organisations, pas aux individus.

L'option la moins chère accessible à un développeur individuel est **Azure Trusted Signing**, environ 120 $/an. Son bénéfice réel ne serait pas SmartScreen mais la réduction des faux positifs antivirus sur le binaire PyInstaller, que le mode `--onedir` atténue déjà sans rien dépenser. Écarté au vu du budget, à reconsidérer seulement si les faux positifs deviennent bloquants chez les utilisateurs.

> **Mode PyInstaller tranché le 2026-08-27 : `--onedir`.** Mesuré sur un prototype embarquant les dépendances réelles du sidecar, lancé par un process parent via un pipe comme le fera Tauri : **335 ms** jusqu'à la première ligne NDJSON en `--onedir` contre **2282 ms** en `--onefile` (médianes sur 5 exécutions), l'écart venant de la réextraction complète dans `%TEMP%` à chaque lancement. C'est cette même auto-extraction qui déclenche les heuristiques antivirus : les deux critères pointent dans la même direction. Coût accepté : 65 fichiers à passer par `bundle.resources` au lieu d'un seul dans `externalBin`, un répertoire de travail à fixer, et autant de fichiers exposés au défaut de remplacement de l'installeur NSIS. Mesures et conséquences : [PRODUCTION.md § Performance](../PRODUCTION.md#benchmarks) et [§ Remplacement du sidecar](../PRODUCTION.md#remplacement-du-sidecar-à-la-mise-à-jour).
