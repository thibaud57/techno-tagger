---
title: "ADR-022 — Modèles du protocole en Pydantic"
status: "accepted"
description: "Les commandes reçues sur stdin, le plan de run et les réponses de techno-scraper sont des modèles Pydantic validés à la construction. Les structures internes restent des dataclasses. Le coût est une seconde extension native dans le binaire PyInstaller."
date: "2026-08-30"
keywords: ["architecture", "adr", "pydantic", "validation", "protocole", "ndjson", "pyinstaller"]
scope: ["docs", "architecture"]
technologies: ["Python", "Pydantic", "PyInstaller", "Mypy"]
---

# 🎯 Contexte

L'[ADR-005](005-sidecar-python-protocole-ndjson.md) a acté un protocole NDJSON bidirectionnel entre l'interface Angular et le sidecar Python, et [ARCHITECTURE.md § Sécurité Backend](../ARCHITECTURE.md#sécurité-backend) en tire une exigence : « toute commande reçue sur `stdin` est validée contre son modèle avant exécution ; une commande malformée produit un événement `error`, jamais un effet de bord partiel ».

Cette exigence n'a jamais été rattachée à une brique technique. `protocol.py` était décrit comme portant « les modèles des commandes et des événements », sans dire ce qu'est un modèle, et aucune bibliothèque de validation n'apparaissait dans les dépendances d'exécution du sidecar. Le trou est apparu en écrivant les `.claude/rules/` du sidecar, où la question devenait bloquante : on ne peut pas écrire une règle sur les modèles sans savoir ce qu'ils sont.

Deux autres frontières relèvent du même sujet, et le rendent plus lourd que le seul parsing des commandes :

- Le **plan de run et les rapports** sont relus depuis le disque, y compris ceux écrits par une version antérieure de l'application. L'[ADR-018](018-versionnement-plan-de-run.md) impose une politique de migration, et la commande `load_run` en est le point d'entrée.
- Les **réponses de techno-scraper** ne sont figées par aucun lockfile. L'API peut évoluer entre deux runs sans qu'aucune dépendance ne bouge, ce qui fait de la validation de ses réponses une protection contre l'API elle-même.

Le contexte de packaging pèse sur le choix. Le sidecar est empaqueté par PyInstaller et distribué sans signature de code, sous une contrainte de budget nul. `rapidfuzz` est aujourd'hui la seule extension native de la stack, et [VERSIONS.md](../VERSIONS.md#conflits-potentiels) documente déjà deux modes de panne qui n'apparaissent que dans le binaire figé, sur `keyring` et sur `sentry-sdk`.

---

# 🧩 Problème

Sur quoi reposent les modèles du protocole, sachant que la validation runtime porte sur trois frontières non maîtrisées, et que toute dépendance supplémentaire est un risque de packaging avant d'être un confort d'écriture ?

---

# 🛠️ Options Envisagées

## Option A : dataclasses et validation écrite à la main

**Description :** `@dataclass(frozen=True, slots=True)` pour tous les modèles, avec des fonctions de parsing qui vérifient la présence des champs, convertissent les types et lèvent une erreur métier. La migration des plans versionnés est un `match` sur `schema_version` suivi de transformations de dictionnaires.

**Avantages :**
- Aucune dépendance ajoutée, donc aucun risque de packaging supplémentaire
- Le binaire ne grossit pas, ce qui compte sur un exécutable déjà exposé aux faux positifs antivirus
- Le contrat est petit : une vingtaine de types, stables une fois figés à l'étape 3 de l'ordre de développement

**Inconvénients :**
- La validation est à écrire, à tester et à maintenir en parallèle des annotations de type, qui décrivent déjà la forme attendue
- Le risque porte sur les cas non écrits : un champ oublié dans un parseur ne se voit pas, alors qu'un modèle déclaratif ne peut pas oublier un champ qu'il déclare
- La migration de schéma se disperse dans du code de transformation de dictionnaires, sans point d'entrée unique par modèle
- Un champ inconnu dans une commande passe silencieusement, sauf à écrire aussi la vérification inverse

**Coût estimé :** quelques centaines de lignes de parsing et leurs tests, réparties sur trois frontières.

## Option B : Pydantic v2 sur les trois frontières

**Description :** `BaseModel` pour les commandes, les événements, le plan de run, les rapports et les réponses de l'API. Les structures purement internes restent des dataclasses. Les commandes sont fermées par `extra="forbid"`, les réponses de l'API restent ouvertes par `extra="ignore"`.

**Avantages :**
- La validation découle des annotations déjà nécessaires au gate Mypy strict, sans code parallèle à maintenir
- `model_validate_json()` parse et valide une ligne NDJSON en une passe, dans le cœur Rust
- `ValidationError.errors()` rend une structure exploitable telle quelle dans les `params` de l'événement `error`
- La migration d'un plan versionné a un point d'entrée unique et testable, le `model_validator(mode="before")`
- Un plugin Mypy est distribué avec la bibliothèque, et PydanticAI (Post-MVP, [ADR-008](008-matching-rapidfuzz-et-agent-ia.md)) repose sur la même définition de modèles

**Inconvénients :**
- `pydantic-core` est une extension native, la seconde du sidecar : un mode de panne de plus à vérifier sur le binaire figé
- Le binaire grossit, et les mesures de démarrage et de taille de [PRODUCTION.md § Benchmarks](../PRODUCTION.md#benchmarks) sont à refaire
- Une dépendance de plus à suivre, avec une cadence de publication soutenue

**Coût estimé :** une ligne de dépendance, une ligne de plugin Mypy, et une vérification au premier build CI.

## Option C : Pydantic sur les seules commandes

**Description :** Pydantic pour ce qui arrive sur `stdin`, dataclasses et parsing manuel pour le plan de run et les réponses de l'API.

**Avantages :**
- Couvre l'exigence explicite d'ARCHITECTURE.md sans étendre la surface

**Inconvénients :**
- Le coût de packaging est payé quoi qu'il arrive dès que Pydantic entre : le limiter ne le réduit pas
- Les deux autres frontières sont celles où la donnée est la moins maîtrisée, un fichier écrit par une version antérieure et une API sans lockfile
- Deux façons de décrire un modèle cohabiteraient dans le même module

**Coût estimé :** identique à l'option B côté packaging, plus le parsing manuel de l'option A sur deux frontières.

---

# 🎉 Décision

**Pydantic v2 sur les trois frontières (option B).** Les commandes, les événements, le plan de run, les rapports et les réponses de techno-scraper sont des `BaseModel`. Les structures internes au pipeline restent des `dataclass(frozen=True, slots=True)`.

Ce qui tranche n'est pas le confort d'écriture mais la nature des trois frontières : aucune des données qui y transitent n'est produite par le sidecar. L'option A demande d'écrire à la main la garantie que les annotations donnent déjà, et son risque porte sur ce qui n'a pas été écrit, c'est-à-dire précisément sur ce qu'on ne prévoit pas. L'option C paie le coût de l'option B sans en prendre le bénéfice là où la donnée est la moins fiable.

Le coût de packaging est réel et il est accepté parce qu'il est **du même type que ceux déjà instruits**, pas d'un type nouveau : `rapidfuzz` est déjà une extension native, `keyring` et `sentry-sdk` ont déjà chacun un mode de panne propre au binaire figé. `pydantic-core` publie ses wheels `cp314` et `cp314t` pour `win_amd64`, et `pyinstaller-hooks-contrib` livre son hook. Le geste à faire est une ligne de plus dans la checklist du premier build, à côté de celles qui existent.

Version retenue : `pydantic>=2.13.5,<3`. La borne basse est 2.12 au minimum, première version compatible Python 3.14 ; le patch retenu est celui relevé au moment de la décision.

---

# 🔄 Conséquences

## Positives

- L'exigence de validation d'ARCHITECTURE.md a enfin une brique qui la porte, et `protocol.py` devient la description exécutable du contrat
- Une commande portant un champ inconnu est rejetée au lieu de passer, ce que ni les annotations seules ni un parsing partiel ne garantissent
- Les erreurs de validation sortent structurées, ce qui alimente les `params` de l'événement `error` sans travail de mise en forme
- La politique de migration de l'ADR-018 a un emplacement unique et testable par modèle versionné
- Le mode agent Post-MVP n'aura aucune dette de modèles à payer, PydanticAI reposant sur les mêmes définitions

## Négatives

- Le binaire embarque une seconde extension native, et les modes de panne propres au binaire figé passent de trois à quatre
- Les benchmarks de démarrage et de taille de PRODUCTION.md sont périmés tant qu'ils n'ont pas été refaits avec Pydantic embarqué
- Une dépendance de plus à suivre, dont la cadence de publication est soutenue
- Le contrat est maintenu en double, modèles Pydantic et types TypeScript miroir, la génération de code restant écartée : un champ ajouté se répercute des deux côtés à la main

---

# 📝 Notes complémentaires

La frontière entre `BaseModel` et `dataclass` est le point à tenir dans la durée. Poser un `BaseModel` sur une structure interne au pipeline paie une validation à chaque construction sans rien protéger, la donnée étant produite par le sidecar lui-même. La règle est écrite dans [`.claude/rules/pydantic/modeles.md`](../../.claude/rules/pydantic/modeles.md) et dans [`.claude/rules/python/modeles-donnees.md`](../../.claude/rules/python/modeles-donnees.md).

Deux réglages ne sont pas symétriques et ne doivent pas être uniformisés par souci de cohérence : `extra="forbid"` sur les commandes, parce qu'un champ inconnu venu de l'interface est un bug du contrat, et `extra="ignore"` sur les réponses de l'API, parce qu'un champ ajouté en amont ne doit pas casser un run.

Détail technique et exemples dans [knowledges/pydantic.md](../knowledges/pydantic.md), versions et compatibilité dans [VERSIONS.md § Pydantic](../VERSIONS.md#3-pydantic).
