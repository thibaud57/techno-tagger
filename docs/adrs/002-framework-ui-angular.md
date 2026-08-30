---
title: "ADR-002 — Framework UI : Angular"
status: "accepted"
description: "Choix d'Angular pour l'interface de l'application desktop, contre React + Next.js, dans un contexte sans serveur et sans logique métier côté interface."
date: "2026-08-02"
keywords: ["architecture", "adr", "angular", "react", "nextjs", "frontend"]
scope: ["docs", "architecture"]
technologies: ["Angular", "React", "Next.js"]
---

# 🎯 Contexte

L'interface de techno-tagger ne contient aucune logique métier : le scoring, la construction des requêtes et les règles d'écriture des tags vivent dans le sidecar Python. Elle affiche des listes, ouvre des modales d'arbitrage, montre une progression et un récapitulatif.

Elle tourne dans une webview locale, sans serveur, sans SEO, sans rendu côté serveur, sans routes d'API. Le projet est mené par une personne seule, sans deadline.

---

# 🧩 Problème

Quel framework retenir pour une interface locale à trois écrans, alimentée par un flux d'événements et sans aucune contrainte web classique ?

---

# 🛠️ Options Envisagées

## Option A : Angular

**Description :** Framework complet avec injection de dépendances, router, signals natifs et outillage CLI intégré.

**Avantages :**
- Déjà maîtrisé par l'auteur, aucun temps d'apprentissage
- L'injection de dépendances rend naturel le partage d'un service de flux NDJSON entre les trois features, sans bibliothèque de store
- Signals natifs suffisants pour l'état du run et la file d'arbitrage
- Router avec lazy loading fourni, sans configuration supplémentaire
- Ne suppose rien d'un serveur : un `ng build` produit des fichiers statiques que Tauri sert directement

**Inconvénients :**
- Verbosité supérieure à React sur des composants simples
- Écosystème de composants desktop moins fourni que celui de React
- Cadence de versions majeures soutenue, qui impose un entretien régulier

**Coût estimé :** Nul en apprentissage.

## Option B : React + Next.js

**Description :** React avec le framework Next.js, le choix par défaut de l'écosystème React actuel.

**Avantages :**
- Écosystème de composants et de bibliothèques le plus large
- Communauté et documentation massives

**Inconvénients :**
- **Next.js n'apporte rien sans serveur Node** : ni SSR, ni routes d'API, ni ISR, ni optimisation d'images côté serveur ne sont exploitables dans une webview locale
- Il faudrait l'exporter en statique, ce qui revient à un React ordinaire avec une couche de configuration en plus à comprendre et à maintenir
- Moins maîtrisé par l'auteur que Angular, donc du temps dépensé ailleurs que sur le métier

**Coût estimé :** Apprentissage non nul, pour un bénéfice nul dans ce contexte.

## Option C : React seul (Vite)

**Description :** React sans méta-framework, build Vite, router et store choisis à la carte.

**Avantages :**
- Aucune couche inutile, exactement le périmètre nécessaire
- Build très rapide

**Inconvénients :**
- Impose de choisir et d'assembler router, store et structure, là où Angular les fournit
- Toujours moins maîtrisé qu'Angular, sans contrepartie technique dans ce contexte

**Coût estimé :** Assemblage à faire, apprentissage résiduel.

---

# 🎉 Décision

**Angular.**

Aucune des options React n'apporte d'avantage technique dans une webview locale sans serveur. Next.js en particulier est disqualifié par construction : ce qui le distingue de React repose sur un runtime serveur qui n'existe pas ici.

Le critère qui tranche est donc la maîtrise. Sur un projet mené seul et sans deadline, le temps gagné va au métier, pas à l'apprentissage d'un framework équivalent.

---

# 🔄 Conséquences

## Positives

- Aucun temps d'apprentissage, l'effort va directement sur le sidecar et le protocole
- Injection de dépendances et signals natifs couvrent le partage d'état sans bibliothèque supplémentaire
- Router et lazy loading disponibles sans assemblage
- Le build statique s'intègre à Tauri via `frontendDist` sans adaptation

## Négatives

- Composants desktop moins nombreux que dans l'écosystème React, ce qui pèse sur le choix de la bibliothèque de composants (cf. [ADR-003](003-primeng-community-license.md))
- Les versions majeures d'Angular arrivent régulièrement et demandent un entretien même sur un projet stable
- Verbosité supérieure sur les composants triviaux

---

# 📝 Notes complémentaires

Le choix du framework n'engage pas le métier : l'interface consomme un protocole de messages (cf. [ADR-005](005-sidecar-python-protocole-ndjson.md)) et pourrait être remplacée sans toucher au sidecar.
