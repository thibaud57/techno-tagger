---
title: "ADR-020 — Doublons de noms de fichiers dans la bibliothèque source"
status: "accepted"
description: "Quand plusieurs fichiers du dossier source portent le même nom, le plus volumineux est retenu et chaque cas est consigné dans le rapport avec les candidats écartés."
date: "2026-08-02"
keywords: ["architecture", "adr", "playlist", "doublons", "resolution", "rapport"]
scope: ["docs", "architecture"]
technologies: ["Python"]
---

# 🎯 Contexte

La résolution d'une entrée de playlist se fait **par nom de fichier, pas par chemin** : le chemin stocké est ignoré, seul le nom est cherché récursivement dans le dossier source. Sans cela le cas principal ne fonctionne pas, la base venant du téléphone Android et les fichiers étant sur le PC.

Cette résolution est ambiguë par construction. Une bibliothèque de DJ accumule des fichiers téléchargés de partout : mêmes titres en plusieurs qualités, doublons purs, ou homonymie entre deux morceaux distincts.

La CLI prend **silencieusement le premier trouvé**, sans trace.

---

# 🧩 Problème

Que faire quand plusieurs fichiers du dossier source portent le même nom, sachant qu'un mauvais choix se propage dans tout le reste du traitement ?

---

# 🛠️ Options Envisagées

## Option A : Prendre le plus gros fichier et le signaler dans le rapport

**Description :** Heuristique automatique privilégiant le fichier le plus volumineux, chaque cas étant consigné dans le rapport avec les candidats écartés, leur chemin et leur taille.

**Avantages :**
- Aucune interruption, cohérent avec un traitement qui ne s'arrête jamais
- La taille est un proxy raisonnable de la qualité entre deux encodages du même morceau
- **Le rapport rend le choix visible et vérifiable après coup**, ce qui est la vraie régression de la CLI
- Aucun écran supplémentaire à concevoir dans un onglet qui n'a aucun mécanisme d'arbitrage
- Le mode copie par défaut rend un mauvais choix rattrapable : la source reste intacte

**Inconvénients :**
- Le proxy est faux dès que les fichiers ne sont pas le même morceau : deux titres homonymes de labels différents
- Le plus gros peut être un WAV non désiré face à un FLAC choisi délibérément
- L'utilisateur découvre le problème après coup

**Coût estimé :** Faible.

## Option B : Demander à l'utilisateur

**Description :** Une modale de désambiguïsation présentant les candidats avec chemin, taille, format et tags actuels.

**Avantages :**
- Décision juste, prise avec l'information nécessaire
- Cohérent avec l'arbitrage déjà présent sur le matching

**Inconvénients :**
- **Se produit dans l'onglet playlist, avant toute phase réseau** : aucun temps mort à masquer, l'utilisateur attend pour de vrai
- Sur une grosse bibliothèque mal rangée, le nombre de doublons peut rendre l'étape épuisante
- Un second mécanisme d'arbitrage à concevoir, dans un onglet qui n'en a pas

**Coût estimé :** Moyen.

## Option C : Tout signaler et ne rien traiter

**Description :** Les entrées ambiguës sont écartées et listées dans le rapport.

**Avantages :**
- Aucune décision arbitraire prise à la place de l'utilisateur

**Inconvénients :**
- Des morceaux manquent dans le dossier de travail, à copier à la main
- Punit le cas fréquent et bénin, celui du doublon strict où n'importe quel exemplaire convenait

**Coût estimé :** Nul, au prix d'une régression d'usage.

---

# 🎉 Décision

**Le fichier le plus volumineux est retenu, chaque cas étant consigné dans le rapport avec les candidats écartés.**

Ce qui est réellement inacceptable dans le comportement de la CLI n'est pas le choix automatique, c'est son **invisibilité**. Un choix automatique tracé se vérifie et se corrige ; un choix silencieux se découvre des semaines plus tard sur un mauvais fichier.

L'option B est écartée par son emplacement dans le flux : elle tomberait dans l'onglet playlist, avant toute phase réseau, donc sans aucun temps d'attente à masquer, contrairement aux arbitrages de matching qui se glissent derrière le temps réseau du pipeline.

Départage retenu, dans l'ordre :

1. **Taille décroissante**, proxy de qualité entre deux encodages du même morceau
2. **À taille égale, ordre alphabétique du chemin**, pour que deux runs successifs sur le même dossier donnent le même résultat

Le rapport consigne pour chaque cas le fichier retenu, les candidats écartés avec leur chemin et leur taille, et le critère appliqué.

---

# 🔄 Conséquences

## Positives

- Le traitement ne s'interrompt jamais et ne demande rien à l'utilisateur avant la phase réseau
- Chaque cas ambigu est vérifiable dans le rapport, ce que la CLI ne permettait pas
- Le résultat est déterministe : deux runs sur le même dossier donnent le même choix
- En mode copie, un mauvais choix se corrige en reprenant le fichier voulu à la main

## Négatives

- L'heuristique se trompera sur les homonymes réels, deux morceaux distincts portant le même nom
- Un WAV volumineux l'emporte sur un FLAC délibérément choisi, alors que le second est probablement le bon
- En mode déplacement, la correction est plus lourde puisque la source a bougé
- Le rapport peut devenir volumineux sur une bibliothèque très désordonnée

---

# 📝 Notes complémentaires

Un titre de la playlist introuvable dans le dossier source est déjà logué, le traitement continuant. Les doublons suivent le même principe de fond : **jamais bloquer le run, toujours laisser une trace exploitable**.

Si l'usage montre que les homonymes réels sont fréquents, la bascule vers une modale de désambiguïsation reste possible sans changement d'architecture : le cas est déjà détecté et matérialisé, seule la résolution changerait.
