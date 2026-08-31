---
title: "ADR-018 — Versionnement du plan de run et du rapport JSON"
status: "accepted"
description: "Le plan et le rapport portent un numéro de version de schéma. Un plan de version inconnue est refusé avec un message explicite, un rapport de version antérieure est migré."
date: "2026-08-29"
keywords: ["architecture", "adr", "plan-de-run", "versionnement", "migration", "rapport"]
scope: ["docs", "architecture"]
technologies: ["Python", "JSON", "Tauri"]
---

# 🎯 Contexte

Chaque décision d'un run est écrite au fil de l'eau dans un plan JSON stocké dans `appLocalDataDir()`, et un run interrompu est détecté au lancement suivant pour proposer une reprise (cf. [ADR-010](010-ecriture-batch-et-plan-de-run.md)).

L'updater vérifie un manifeste au démarrage et propose une mise à jour. Le scénario problématique est direct : un run est interrompu, l'application se met à jour, le format du plan a changé entre-temps.

Deux artefacts JSON sont concernés, aux durées de vie très différentes :

| Artefact | Emplacement | Durée de vie |
|---|---|---|
| Plan de run | `appLocalDataDir()` | Purgé si terminé, 30 jours maximum si interrompu |
| Rapport | Dossier destination | **Permanente**, relu par l'application pour rouvrir un run passé |

---

# 🧩 Problème

Un plan ou un rapport écrit par une version antérieure doit-il rester exploitable après mise à jour, et selon quel mécanisme ?

---

# 🛠️ Options Envisagées

## Option A : Numéro de version, refus explicite si incompatible

**Description :** L'artefact porte un champ de version de schéma. Si la version ne correspond pas à celle attendue, l'application refuse et explique pourquoi.

**Avantages :**
- Trivial : un champ et une comparaison
- **Aucune reprise silencieusement corrompue** : le pire cas est un message clair, pas un run appliqué sur des données mal interprétées
- Aucune migration à écrire ni à tester

**Inconvénients :**
- L'utilisateur perd ses arbitrages et relance le run depuis zéro
- Inacceptable sur un artefact à durée de vie permanente

**Coût estimé :** Quelques lignes.

## Option B : Numéro de version et migrations

**Description :** Même champ, plus des fonctions de migration d'une version de schéma à la suivante.

**Avantages :**
- Aucune perte, quelle que soit la version d'origine
- Indispensable dès qu'un artefact est conservé indéfiniment

**Inconvénients :**
- Chaque changement de schéma impose d'écrire et de **tester** une migration
- Les migrations s'accumulent et doivent rester exécutables en chaîne

**Coût estimé :** Faible unitairement, permanent.

## Option C : Aucun versionnement

**Description :** Relire l'artefact tel quel.

**Avantages :**
- Rien à écrire

**Inconvénients :**
- **Un schéma modifié produit soit un plantage, soit une lecture sur des données mal interprétées**, le second cas étant bien pire
- Aucun diagnostic possible depuis un rapport d'erreur

**Coût estimé :** Nul, jusqu'au premier incident.

---

# 🎉 Décision

**Champ de version sur les deux artefacts, avec deux politiques distinctes justifiées par leur durée de vie.**

- **Plan de run : option A, refus explicite.** Sa durée de vie est plafonnée à 30 jours et il ne survit pas à un run terminé. Écrire des migrations pour un artefact que l'utilisateur peut de toute façon abandonner en relançant son run coûterait plus cher que le service rendu. Le message nomme les deux versions et propose de repartir de zéro.
- **Rapport : option B, migration.** Il est **permanent**, vit dans le dossier de musique de l'utilisateur et sert de base à la relecture d'un run passé comme à l'envoi de feedback. Refuser de le lire reviendrait à rendre inutilisables des rapports que rien ne remplace.

Le champ de version est posé **dès la première version** sur les deux artefacts. L'ajouter après coup laisserait une génération d'artefacts non identifiables, précisément le cas que le mécanisme doit éviter.

Le schéma du plan est figé à l'étape 3 de l'ordre de développement, en même temps que le protocole NDJSON, ce qui limite structurellement le nombre de changements après le MVP.

---

# 🔄 Conséquences

## Positives

- Aucune reprise ni relecture ne peut s'exécuter sur des données mal interprétées
- Un rapport reste lisible par l'application quelle que soit la version qui l'a écrit
- Le coût des migrations est concentré sur le seul artefact qui le justifie
- Le message de refus sur un plan incompatible est explicite et actionnable

## Négatives

- Sur un plan incompatible, l'utilisateur perd ses arbitrages au pire moment
- Le rapport porte un coût de maintenance permanent dès que son schéma bouge
- Deux politiques différentes sur deux artefacts JSON voisins, à expliquer dans le code pour éviter qu'on les aligne par réflexe

---

# 📝 Notes complémentaires

Le format Markdown du rapport n'est pas versionné : il est un rendu, jamais relu par l'application, et se régénère depuis le JSON.

La question ne se pose pas pour le protocole NDJSON : l'interface et le sidecar sont empaquetés dans le même installeur et ne peuvent pas diverger en version.

> ⚠️ **Cette affirmation vaut en régime nominal seulement.** Deux cas font diverger les deux couches : l'installeur NSIS ne remplace pas le binaire du sidecar lors d'une réinstallation de la même version ([tauri#15134](https://github.com/tauri-apps/tauri/issues/15134)), et une mise en quarantaine antivirus peut laisser une copie ancienne en place. L'interface interroge donc la version du sidecar au démarrage, par la commande `get_version` et l'événement `version` du contrat, et refuse de lancer un run si elle diffère de la sienne. Le protocole n'est pas versionné pour autant : le contrôle porte sur la version applicative, pas sur un champ de schéma. Cf. [ARCHITECTURE.md § Backend > API](../ARCHITECTURE.md#api) et [PRODUCTION.md § Remplacement du sidecar à la mise à jour](../PRODUCTION.md#remplacement-du-sidecar-à-la-mise-à-jour).
