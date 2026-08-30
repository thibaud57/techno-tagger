---
title: "ADR-009 — Enchaînement des sources et arbitrage utilisateur"
status: "accepted"
description: "Beatport puis Bandcamp, jamais spéculativement, avec une modale à deux temps qui reste ouverte pendant l'appel de secours et n'affiche que les candidats en zone grise."
date: "2026-08-02"
keywords: ["architecture", "adr", "arbitrage", "beatport", "bandcamp", "soundcloud", "ux"]
scope: ["docs", "architecture"]
technologies: ["techno-scraper", "rapidfuzz", "Angular"]
---

# 🎯 Contexte

Chaque morceau est cherché d'abord sur Beatport. Le scoring produit trois états : **auto**, **zone grise**, **vide**. Bandcamp est la source de secours, sa couverture étant complémentaire (sorties de niche, autoproductions) mais ses métadonnées bien plus pauvres.

SoundCloud n'est jamais interrogé en recherche automatique, ses métadonnées d'upload étant trop peu fiables ; il n'est accepté qu'en saisie d'URL.

Dans la CLI actuelle, la confirmation se fait au clavier en ligne de commande, sans voir les candidats côte à côte, et le matching est binaire.

---

# 🧩 Problème

Quand appeler Bandcamp, et comment présenter les candidats ambigus sans multiplier les appels inutiles ni faire réapparaître un morceau plus loin dans la liste ?

---

# 🛠️ Options Envisagées

## Option A : Modale à deux temps, appel Bandcamp déclenché par le refus

**Description :** En zone grise, la modale affiche les candidats Beatport. Un refus explicite déclenche l'appel Bandcamp, et **sa liste remplace celle de Beatport dans la même fenêtre**, l'en-tête indiquant la bascule et un lien discret permettant de revenir en arrière.

**Avantages :**
- **Zéro appel inutile** : Bandcamp n'est jamais interrogé quand un candidat Beatport convient
- **Le refus n'est pas un pari** : la réponse Bandcamp arrive sous les yeux de l'utilisateur, dans la même fenêtre
- Aucun morceau remis en file, donc aucune réapparition plus loin dans la liste
- Une seule décision par morceau, dans un seul contexte mental

**Inconvénients :**
- La modale reste ouverte pendant un appel réseau, avec un temps d'attente visible
- Deux états d'affichage à gérer dans un même composant
- Un événement supplémentaire dans le protocole (`arbitration_updated`)

**Coût estimé :** Faible, quelques dizaines de lignes de plus que l'option la plus naïve.

## Option B : Appel Bandcamp spéculatif, en parallèle de Beatport

**Description :** Interroger les deux sources systématiquement, et présenter tous les candidats d'un coup.

**Avantages :**
- Aucune attente dans la modale, tout est déjà là
- Un seul état d'affichage

**Inconvénients :**
- **Paie Bandcamp même quand un candidat Beatport convient**, c'est-à-dire dans la majorité des cas
- Double la charge sur techno-scraper pour rien, alors que le débit est justement le facteur limitant
- Mélange dans une même liste des candidats de qualité de métadonnées très inégale

**Coût estimé :** Faible à écrire, coûteux à l'exécution.

## Option C : Remise en file et seconde modale plus tard

**Description :** Un refus renvoie le morceau dans la file, l'appel Bandcamp part en fond, et une nouvelle modale s'ouvrira plus tard avec les candidats Bandcamp.

**Avantages :**
- Pas d'attente dans la modale, l'utilisateur enchaîne les arbitrages sans blocage
- Appel Bandcamp non spéculatif

**Inconvénients :**
- **Transforme le refus en pari à l'aveugle** : l'utilisateur refuse sans savoir si l'alternative existe
- Le morceau réapparaît plus loin, hors de son contexte, avec un coût de re-contextualisation à chaque fois
- Complexifie la file et le compteur d'arbitrages

**Coût estimé :** Moyen, pour une expérience dégradée.

---

# 🎉 Décision

**Modale à deux temps, appel Bandcamp déclenché au moment du refus, la modale restant ouverte.**

Cette option est la seule à réunir les deux bénéfices : ne jamais payer un appel inutile, et ne jamais demander une décision à l'aveugle.

**Seuls les candidats en zone grise sont affichés**, avec leur score. Cinq résultats renvoyés dont trois en zone grise donnent trois lignes. La contrepartie est assumée : un bon match mal scoré reste invisible.

**Un seul état d'échec.** Zéro résultat, candidats tous sous le plancher et refus utilisateur convergent vers « non résolu », le paquet que la phase URL rattrape en fin de run.

**Le pipeline ne s'arrête jamais.** Les morceaux ambigus s'empilent en file, la modale s'ouvre dès qu'il y en a un et qu'aucune n'est déjà ouverte. Le flux d'événements NDJSON étant de toute façon imposé par la barre de progression, laisser le pipeline tourner en fond coûte quelques dizaines de lignes et masque le temps d'arbitrage derrière le temps réseau.

---

# 🔄 Conséquences

## Positives

- Un appel Bandcamp par morceau au maximum, et seulement quand Beatport a échoué ou été refusé
- L'utilisateur décide toujours en voyant ses options, jamais en pariant
- Liste de candidats courte et lisible, chaque ligne étant réellement plausible
- Le temps d'arbitrage est masqué par le temps réseau du reste du pipeline
- Un seul état d'échec simplifie la phase de rattrapage et le rapport

## Négatives

- Attente visible dans la modale pendant l'appel Bandcamp, sur une action utilisateur
- Un bon candidat mal scoré n'est jamais montré, et le morceau part en non résolu alors que la réponse était dans la liste
- Le composant de modale gère deux états et une bascule réversible, plus un cas « Bandcamp n'a rien renvoyé »
- La file d'arbitrage vit dans le sidecar et doit rester cohérente avec ce que l'interface affiche

---

# 📝 Notes complémentaires

Comportements de la modale retenus au MVP :

- Navigation entre arbitrages en attente par flèches, avec compteur (1/3, 2/3), la file se réduisant au fil des décisions
- Fermeture possible par la croix, l'arbitrage restant en file
- Si Bandcamp ne renvoie rien : message dans la modale, une seule action pour passer au suivant, le morceau part en non résolu
- Tentative de quitter l'application avec des morceaux encore en cours : modale de confirmation

Post-MVP, l'agent IA s'insère avant l'ouverture de la modale sur la zone grise (cf. [ADR-008](008-matching-rapidfuzz-et-agent-ia.md)), sans modifier cet enchaînement.
