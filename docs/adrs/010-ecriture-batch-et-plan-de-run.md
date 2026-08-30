---
title: "ADR-010 — Écriture batch en fin de run et plan persisté au fil de l'eau"
status: "accepted"
description: "Aucun fichier n'est modifié avant confirmation globale, mais chaque décision est écrite immédiatement dans un plan JSON stocké dans appLocalDataDir, ce qui rend la reprise triviale."
date: "2026-08-02"
keywords: ["architecture", "adr", "plan-de-run", "reprise", "rollback", "integrite"]
scope: ["docs", "architecture"]
technologies: ["Python", "Tauri", "JSON"]
---

# 🎯 Contexte

Un run traite environ 100 morceaux et enchaîne une phase réseau longue (interrogation de l'API, arbitrages humains), une phase de rattrapage par URL, puis une phase d'écriture locale.

L'écriture des tags est locale et dure quelques secondes, les pochettes ayant été téléchargées et mises en cache pendant la phase réseau.

Le risque à couvrir n'est pas la lenteur mais la perte : une session d'arbitrage représente plusieurs dizaines de décisions humaines qu'on ne veut refaire sous aucun prétexte.

---

# 🧩 Problème

À quel moment écrire dans les fichiers musicaux, et comment survivre à un crash ou à une fermeture en cours de run ?

---

# 🛠️ Options Envisagées

## Option A : Écriture batch en fin de run, plan JSON persisté à chaque décision

**Description :** Chaque décision (validation auto, arbitrage, URL manuelle, abandon) est écrite immédiatement dans un plan JSON. Aucun octet n'est écrit dans les fichiers musicaux avant la confirmation globale.

**Avantages :**
- **Un crash ne laisse jamais un dossier à moitié réécrit** : les fichiers sont dans leur état d'origine ou dans leur état final, jamais entre les deux
- L'écran de confirmation confirme réellement quelque chose
- Une seule passe d'écriture, après la phase URL manuelle
- La reprise est triviale : le plan contient l'état exact, et aucun fichier n'a bougé
- Le dump JSON des tags d'origine se fait juste avant l'écriture, en une passe, ce qui rend le rollback complet

**Inconvénients :**
- Le plan devient un état à gérer : format, versionnement, purge, détection au lancement
- L'utilisateur ne voit aucun effet sur son disque avant la toute fin
- Une écriture par lot qui échoue à mi-parcours laisse un run partiellement appliqué, à traiter explicitement

**Coût estimé :** Faible. Le plan est un fichier JSON écrit en append logique à chaque décision.

## Option B : Écriture immédiate, morceau par morceau

**Description :** Dès qu'un morceau est résolu, ses tags sont écrits et le fichier renommé.

**Avantages :**
- Aucun état intermédiaire à persister, le disque est la source de vérité
- L'utilisateur voit le résultat arriver au fil de l'eau
- Une interruption ne perd que le morceau en cours

**Inconvénients :**
- **Un crash laisse un dossier à moitié renommé**, dans un état ni ancien ni nouveau
- L'écran de confirmation ne confirme plus rien, tout étant déjà fait
- Impose une **seconde passe d'écriture** après la phase de rattrapage par URL
- Le rollback devient partiel et beaucoup plus difficile à raisonner
- Anticiper une écriture qui dure quelques secondes ne gagne rien

**Coût estimé :** Faible à écrire, coûteux en cas d'incident.

## Option C : Écriture immédiate dans une copie de travail

**Description :** Écrire au fil de l'eau, mais dans des copies, et permuter à la confirmation.

**Avantages :**
- Fichiers d'origine intacts jusqu'à la fin
- Effet visible au fil de l'eau

**Inconvénients :**
- Double l'espace disque nécessaire sur des bibliothèques musicales volumineuses
- La permutation finale est elle-même une opération qui peut échouer à mi-parcours
- Complexité sans rapport avec le gain, l'écriture réelle durant quelques secondes

**Coût estimé :** Élevé pour rien.

---

# 🎉 Décision

**Écriture batch après confirmation globale, plan JSON persisté au fil de l'eau dans `appLocalDataDir()`.**

Le raisonnement tient en une phrase : le risque de perdre une session d'arbitrage se corrige en persistant le plan, pas en écrivant les fichiers. Écrire tôt ne rachète rien puisque l'écriture ne dure que quelques secondes, et coûte un dossier à moitié renommé en cas de crash, un écran de confirmation qui ne confirme plus rien, et une seconde passe après la phase URL.

Le plan vit dans `appLocalDataDir()` et non dans le dossier destination : c'est un **état de session, pas un livrable**, et le dossier de musique peut être déplacé ou renommé, ce qui casserait la reprise.

---

# 🔄 Conséquences

## Positives

- Les fichiers musicaux sont dans un état cohérent quoi qu'il arrive avant la confirmation
- Un run interrompu est détecté au lancement suivant, avec une reprise sans risque puisque rien n'a été touché
- Le dump JSON des tags d'origine, fait en une passe juste avant l'écriture, rend le rollback par run ou par morceau possible
- La phase d'écriture est séparable et testable sans réseau ni interface

## Négatives

- Le plan JSON est un format à concevoir, à purger et probablement à versionner (cf. [ADR-018](018-versionnement-plan-de-run.md))
- L'utilisateur attend la fin du run pour voir le moindre effet sur son disque
- Un échec pendant la phase d'écriture elle-même laisse un run partiellement appliqué, cas à traiter explicitement via le rollback
- Une purge automatique est nécessaire pour ne pas accumuler des plans indéfiniment

---

# 📝 Notes complémentaires

Cycle de vie du plan retenu au MVP :

- Écriture au fil de l'eau à chaque décision, dans `appLocalDataDir()`
- Détection au lancement suivant : « Run du 2 août sur `D:\Sets\Août`, 62/100 traités, reprendre ou repartir de zéro ? »
- Purge automatique au démarrage : plans des runs terminés et écrits supprimés, runs interrompus conservés, plafond d'ancienneté à 30 jours
- **Le dump des tags d'origine ne suit pas cette purge** : il vit 30 jours quel que soit l'état du run. Le lier au plan reviendrait à ne proposer le rollback que dans la session qui vient d'écrire, alors que c'est justement au lancement suivant, en réécoutant sa bibliothèque, qu'on s'aperçoit qu'un run s'est mal passé. Le coût est négligeable, les tags de 100 morceaux pesant quelques centaines de kilooctets

Le **rapport**, lui, est un livrable et va dans le dossier destination, en JSON (source de vérité, relue par l'application pour rouvrir un run passé) et en Markdown (lisible hors application). Cf. [ADR-014](014-observabilite-sentry-et-rgpd.md).
