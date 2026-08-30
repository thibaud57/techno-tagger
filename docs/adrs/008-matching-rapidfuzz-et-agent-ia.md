---
title: "ADR-008 — Matching : rapidfuzz au MVP, agent IA en renfort Post-MVP"
status: "accepted"
description: "rapidfuzz remplace fuzzywuzzy comme moteur de matching, et l'agent IA PydanticAI reste un mode activable Post-MVP qui intervient en renfort du fuzzy, jamais à sa place."
date: "2026-08-02"
keywords: ["architecture", "adr", "matching", "rapidfuzz", "fuzzywuzzy", "pydanticai", "ia"]
scope: ["docs", "architecture"]
technologies: ["rapidfuzz", "fuzzywuzzy", "PydanticAI", "Python"]
---

# 🎯 Contexte

Le cœur du re-tagging est la mise en correspondance d'un fichier local avec un morceau renvoyé par l'API. La CLI actuelle utilise **fuzzywuzzy**, dont l'accélérateur `python-Levenshtein` est sous licence **GPLv2**, incompatible avec une distribution sereine. Le projet a été renommé TheFuzz en 2021, sans que cela change la licence de l'accélérateur.

Le matching produit trois états : **auto** (un candidat au-dessus du seuil haut), **zone grise** (candidats plausibles, décision humaine), **vide** (zéro résultat ou tout sous le plancher).

techno-scraper ne fait ni fallback ni matching par conception, cette logique appartient au consommateur.

---

# 🧩 Problème

Quel moteur de matching retenir, et faut-il confier l'arbitrage à un modèle de langage plutôt qu'à un score de similarité ?

---

# 🛠️ Options Envisagées

## Option A : rapidfuzz au MVP, agent IA en renfort Post-MVP

**Description :** rapidfuzz comme moteur unique au MVP. Post-MVP, un agent PydanticAI devient un mode activable, désactivé par défaut, qui intervient sur deux points d'insertion : la zone grise (il tranche avant d'ouvrir la modale) et les non résolus (il reformule la requête et relance).

**Avantages :**
- Livrable rapidement, rapidfuzz étant un remplaçant quasi direct de fuzzywuzzy
- **Aucune dépendance externe, aucun coût par morceau** au MVP
- L'application reste entièrement fonctionnelle sans clé de fournisseur IA
- rapidfuzz est MIT, plus rapide que fuzzywuzzy, à l'API proche
- L'agent, quand il arrive, se greffe sur une chaîne déjà éprouvée et mesurable : on saura ce qu'il améliore

**Inconvénients :**
- Le fuzzy ne comprend rien à la sémantique : une translittération, un artiste mal découpé ou une orthographe approximative restent des échecs
- Les seuils doivent être réglés, et leur bon réglage n'est pas connu d'avance
- Deux chemins de code à maintenir Post-MVP

**Coût estimé :** Faible au MVP. Post-MVP, une section Settings dédiée et le coût des appels, payé par chaque utilisateur.

## Option B : Agent IA dès le MVP, en remplacement du fuzzy

**Description :** Confier directement l'appariement à un modèle de langage recevant le morceau et les candidats.

**Avantages :**
- Comprend les variantes orthographiques, les translittérations et les découpages d'artistes
- Réduirait probablement le nombre d'arbitrages manuels

**Inconvénients :**
- **Impose une clé de fournisseur IA à chaque utilisateur** pour que l'application fonctionne du tout : rédhibitoire pour un outil partagé entre amis
- Coût par morceau, sur des runs de 100 titres
- Latence supérieure et non déterministe, sur un pipeline déjà borné par le réseau
- Sans base fuzzy, aucun moyen de mesurer ce que l'IA apporte ni de retomber sur ses pieds quand elle se trompe
- Décale la livraison du MVP

**Coût estimé :** Élevé, en argent comme en délai.

## Option C : Rester sur fuzzywuzzy, ou passer à TheFuzz

**Description :** Conserver la bibliothèque de la CLI actuelle. fuzzywuzzy a été renommé **TheFuzz** en 2021, sous le même toit, ce qui est la seule voie encore alimentée.

**Avantages :**
- Aucun changement, seuils existants transposables tels quels
- TheFuzz reste disponible et fonctionnel

**Inconvénients :**
- Son accélérateur `python-Levenshtein` est sous **GPLv2**, ce qui contamine la distribution d'un binaire, et le renommage n'a pas résolu ce point
- Sans cet accélérateur, les performances s'effondrent
- rapidfuzz est précisément né d'une version MIT de fuzzywuzzy et en est devenu le successeur de fait

**Coût estimé :** Nul immédiatement, problématique en licence.

---

# 🎉 Décision

**rapidfuzz au MVP. Agent IA PydanticAI en renfort Post-MVP, jamais en remplacement.**

fuzzywuzzy est écarté sur la licence : distribuer un binaire embarquant du GPLv2 n'est pas une question qu'on veut avoir à se poser. rapidfuzz descend d'ailleurs d'une version MIT de fuzzywuzzy, si bien que **le changement de bibliothèque** ne déplace pas les scores. Le changement de source, lui, les déplace : les seuils de la CLI restent à recalibrer, cf. Conséquences négatives.

L'agent IA est repoussé parce qu'en faire un prérequis reviendrait à exiger une clé de fournisseur payante de chaque ami DJ pour que l'outil démarre. En renfort, il ne coûte rien à qui ne l'active pas, et il se branche là où le fuzzy s'arrête réellement.

L'orchestration reste dans le sidecar via **PydanticAI**, pas dans un agent n8n appelé par webhook : l'application doit fonctionner sans infrastructure distante.

---

# 🔄 Conséquences

## Positives

- MVP livrable sans dépendance IA, sans coût récurrent et sans clé supplémentaire à distribuer
- Licence MIT propre sur toute la chaîne de matching
- La chaîne fuzzy sert de base de comparaison mesurable quand l'agent arrivera
- L'agent, quand activé, n'interrompt l'utilisateur que lorsqu'il hésite lui-même

## Négatives

- Les cas sémantiques (translittération, orthographe approximative, artiste mal découpé) restent des échecs au MVP, rattrapés seulement par la saisie d'URL
- Les seuils par défaut sont à recalibrer : ceux de la CLI ne sont pas transposables tels quels, le contrat de sortie de l'API ayant changé
- Post-MVP, deux chemins de code à maintenir, et une section Settings dédiée (clé du fournisseur, sélection du modèle)
- La liste des modèles proposés ne doit pas être codée en dur, sous peine de maintenance à chaque sortie ; le mécanisme reste à définir

---

# 📝 Notes complémentaires

Les deux points d'insertion de l'agent Post-MVP sont précis et limités :

- **Zone grise**, avant d'ouvrir la modale : l'agent reçoit le morceau et les candidats et tranche. Certain, il valide sans interrompre. Hésitant, la modale s'ouvre avec son candidat recommandé et sa justification.
- **Non résolu**, avant la phase URL : l'agent peut reformuler la requête et relancer une recherche plutôt que d'abandonner.

La piste d'un agent n8n appelé par webhook, présente dans les premières notes, est abandonnée : elle rendrait l'application dépendante d'une infrastructure distante que ses utilisateurs n'ont pas.
