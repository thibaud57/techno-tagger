---
title: "ADR-014 — Observabilité, rapports et ce qui sort de la machine"
status: "accepted"
description: "Sentry limité aux crashs et actif d'office, protégé par un durcissement du SDK plutôt que par un consentement, rapports locaux en JSON et Markdown, envoi de feedback comme geste explicite."
date: "2026-08-29"
keywords: ["architecture", "adr", "sentry", "observabilite", "rapport", "privacy"]
scope: ["docs", "architecture"]
technologies: ["Sentry", "Python", "Angular"]
---

# 🎯 Contexte

L'application est distribuée à quelques amis DJ, sur leurs machines, sans accès à distance. Quand quelque chose casse chez eux, il n'y a aucun moyen de le savoir autrement qu'en le leur demandant.

La CLI actuelle ne laisse aucune trace exploitable de ce qui a coincé, donc aucun moyen d'améliorer le matching.

Le plan Sentry Developer est gratuit et plafonne à **5 000 erreurs par mois**, au-delà desquelles les suivantes sont **jetées silencieusement**.

Deux natures de données coexistent : les erreurs techniques, qui n'intéressent que le débogage, et les titres de morceaux traités, qui appartiennent à l'utilisateur.

---

# 🧩 Problème

Comment savoir ce qui casse chez les utilisateurs et améliorer le matching, sans transformer un outil local en collecteur de données d'écoute ?

---

# 🛠️ Options Envisagées

## Option A : Crashs uniquement, SDK durci, rapports locaux et feedback manuel

**Description :** Sentry actif d'office, sans écran de consentement, mais configuré pour ne pouvoir envoyer que des erreurs techniques dépouillées. Les cas d'arbitrage et d'échec restent dans un rapport local, dont l'envoi est un bouton dédié.

**Avantages :**
- **Le quota gratuit reste disponible pour les vrais bugs**, jamais noyé sous de la télémétrie
- **La protection est technique, pas déclarative** : ce n'est pas une case à cocher qui empêche une donnée de partir, c'est la configuration du SDK
- Un plantage chez un ami remonte sans qu'il ait à penser à quoi que ce soit
- Aucun écran supplémentaire, aucune branche d'initialisation conditionnelle, aucune traduction à maintenir
- Le rapport local existe de toute façon comme livrable du run, l'envoi n'ajoute qu'un bouton

**Inconvénients :**
- L'utilisateur n'est pas informé que les plantages remontent
- Les statistiques de matching ne remontent que si quelqu'un appuie sur le bouton, donc rarement
- Les réglages de durcissement doivent être testés, sans quoi la protection est fictive

**Coût estimé :** Faible, plan gratuit.

## Option B : Consentement explicite au premier lancement

**Description :** Case décochée par défaut sur l'écran d'accueil, initialisation des SDK conditionnée à la réponse.

**Avantages :**
- L'utilisateur sait ce qui part et peut refuser
- Posture défendable si l'outil sortait un jour du cercle amical

**Inconvénients :**
- Sur un outil personnel non commercialisé, la formalité ne protège de rien de plus que le durcissement, qui reste nécessaire dans les deux cas
- Coûte un élément d'interface, sa traduction, et une branche à l'initialisation
- Un crash survenu avant la réponse de l'utilisateur n'est jamais remonté, précisément au moment le plus intéressant à observer

**Coût estimé :** Faible, pour un gain nul ici.

## Option C : Sentry avec événements métier

**Description :** Envoyer aussi les cas d'arbitrage, les échecs et les scores.

**Avantages :**
- Vision continue de la qualité du matching, sans action de l'utilisateur

**Inconvénients :**
- **Noyer les crashs sous de la télémétrie ferait perdre le vrai bug quand il arrive**, le plan gratuit jetant silencieusement au-delà de 5 000 événements
- Enverrait en continu les titres écoutés par des amis, chez un tiers, sans qu'ils l'aient demandé

**Coût estimé :** Gratuit en argent, coûteux en fiabilité.

## Option D : Aucune remontée, logs locaux uniquement

**Description :** Tout reste sur la machine, l'utilisateur envoie ses logs à la demande.

**Avantages :**
- Aucune dépendance externe, rien ne quitte la machine

**Inconvénients :**
- Un plantage chez un ami reste invisible jusqu'à ce qu'il pense à le signaler, avec la bonne trace
- Aucune stack trace exploitable en pratique : un utilisateur non technique n'ira pas chercher un fichier de log

**Coût estimé :** Nul, aveugle.

---

# 🎉 Décision

**Sentry actif d'office pour les crashs uniquement, protégé par un durcissement du SDK, plus des rapports locaux et un envoi de feedback manuel.**

Le quota gratuit est traité comme une ressource rare : réservé à ce qu'on ne peut pas obtenir autrement, les plantages. Les statistiques de matching sont déjà intégralement dans le rapport local ; les pousser en continu coûterait le quota pour une information qu'on possède déjà.

Le consentement est écarté parce qu'il **déplace la protection au mauvais endroit**. Une case à cocher n'empêche aucune donnée de partir, elle conditionne seulement le fait d'envoyer. Ce qui détermine réellement le contenu d'un événement, c'est la configuration du SDK, et elle reste nécessaire avec ou sans consentement.

## Durcissement, non négociable

| Réglage | Valeur | Pourquoi |
|---|---|---|
| `include_local_variables` | `False` | **Vaut `True` par défaut.** Le SDK joint alors un instantané des variables locales de chaque frame : chemins complets, artiste et titre en cours, et potentiellement la clé API si elle passe par une variable locale de `scraper_client.py`. |
| `server_name` | valeur fixe | Auto-détecté par défaut, donc le nom de la machine part avec chaque événement. |
| `send_default_pii` | défaut conservé | Déjà à `False`, ne pas l'activer. |

S'y ajoute le **scrubbing des chemins de fichiers** dans les frames, qui contiennent le nom d'utilisateur de l'OS.

## Reste du dispositif

- **Sentry** : `sentry-sdk` côté Python, `@sentry/angular` côté webview. Plan Developer gratuit, **région EU**. Erreurs techniques uniquement : sidecar qui tombe, API injoignable, parsing cassé.
- **Logs locaux** : `logging` Python vers un fichier tournant dans `appLocalDataDir()`, avec un bouton « ouvrir le dossier de logs » dans les Settings. `stderr` seul serait invisible dans une application empaquetée.
- **Rapport de run** dans le dossier destination, en **JSON** (source de vérité, relu par l'application, base de l'envoi de feedback) et en **Markdown** (rendu lisible hors application). Les deux sont **en anglais**, quelle que soit la langue de l'interface.
- **Bouton « envoyer ce rapport pour améliorer le matching »** dans l'écran final. C'est le **seul endroit où des titres de morceaux quittent la machine**, donc le seul où un geste explicite a un sens. Ne consomme pas le quota Sentry.

  **Forme retenue : une issue GitHub pré-remplie**, ouverte dans le navigateur par le plugin `opener`, avec un label dédié au retour de matching. Aucun endpoint à héberger, ce que le budget nul impose, et l'application ne pousse rien d'elle-même.

  > ⚠️ **Le dépôt est public ([ADR-021](021-visibilite-du-depot.md)), donc l'issue l'est aussi, titres de morceaux compris.** C'est assumé : il s'agit de sorties commerciales, et surtout un rapport de matching amputé de ses titres ne diagnostique plus rien, puisque ce qu'on cherche à comprendre est précisément l'écart entre un nom de fichier, la requête qui en est tirée et le candidat renvoyé. Le garde-fou n'est donc pas la censure du contenu mais **la relecture** : l'utilisateur voit l'issue dans son navigateur et peut couper ou renoncer avant de valider.

---

# 🔄 Conséquences

## Positives

- Un plantage chez un ami remonte automatiquement, avec sa stack trace, sans rien lui demander et sans qu'il puisse l'oublier
- La protection repose sur trois réglages vérifiables plutôt que sur une déclaration d'intention
- Le quota gratuit reste disponible pour ce qui compte
- Aucun écran, aucune traduction, aucune branche d'initialisation à maintenir
- Le rapport JSON sert trois usages avec un seul artefact : relecture par l'application, lisibilité humaine via le Markdown, et feedback

## Négatives

- **L'utilisateur ignore que ses plantages remontent.** Assumé sur un outil personnel entre amis, à revoir si la distribution s'élargissait
- Les trois réglages de durcissement sont la seule protection : un oubli ou une régression expose immédiatement des données personnelles, d'où leur couverture par un test
- Les données de matching ne remontent qu'au gré des envois manuels, donc rarement et sans représentativité
- Deux canaux à maintenir, avec deux formats de charge utile

---

# 📝 Notes complémentaires

**Sur le cadre réglementaire.** Outil personnel distribué à quelques amis, sans commercialisation : le RGPD prévoit une exception pour les traitements effectués par une personne physique dans le cadre d'une activité strictement personnelle ou domestique. L'exception s'interprète restrictivement et le recours à un tiers comme Sentry en sort techniquement, mais la question reste théorique précisément parce que le durcissement garantit que **rien de personnel ne part** : pas de titre de morceau, pas de chemin de fichier, pas de nom de machine, pas d'identifiant.

Un test de sécurité vérifie explicitement que ni la clé API, ni les chemins, ni les titres n'apparaissent dans les payloads Sentry. C'est ce test qui tient la décision, pas le texte de cet ADR.

Le rapport détaille par morceau : requête envoyée, source ayant répondu, décision et son origine, champs écrits, ancien et nouveau nom de fichier, erreurs. Il indique aussi le nombre de champs écrits, ce qui rend visibles les fichiers tagués à moitié (cf. [ADR-011](011-politique-ecriture-tags.md)).

**Sur la langue des rapports.** L'interface existe en français et en anglais (cf. [ADR-004](004-i18n-ngx-translate.md)), les rapports non : ils sont en anglais dans les deux cas. Le JSON l'est déjà par construction, ses clés et ses valeurs d'énumération étant celles du contrat NDJSON (`state`, `resolution`, `no_result`, `file_locked`). Le Markdown n'en étant que le rendu, le traduire produirait un artefact hybride, des libellés français posés sur des codes anglais, et cela pour la dizaine de mots de structure qui séparent les deux formats : tout le reste du rapport est de la donnée, titres, artistes, chemins et scores.

Les deux options écartées coûtaient plus que ce qu'elles rapportaient. Faire traduire le Markdown par le sidecar y installerait une seconde i18n, exactement ce que la règle « le sidecar n'émet qu'un `code` et des `params` » cherche à éviter. Le faire générer par l'interface depuis le JSON garderait une i18n unique, mais obligerait Angular à écrire un fichier dans le dossier de musique via le plugin `fs`, alors que toutes les écritures disque vivent dans le sidecar.

La règle des `code` + `params` porte donc sur le **flux NDJSON**, pas sur les fichiers que le sidecar écrit lui-même. Rapports et logs n'ont jamais l'interface pour intermédiaire.

Le DSN Sentry est injecté au build depuis un secret GitHub Actions. Un DSN vide rend le SDK inerte, ce qui reste le moyen de désactiver la remontée en développement.

Référence : [Sentry — Options Python](https://docs.sentry.io/platforms/python/configuration/options/).
