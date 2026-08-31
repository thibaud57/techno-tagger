---
title: "ADR-013 — Cache disque jetable : TTL 30 jours, plafond 500 Mo, LRU"
status: "accepted"
description: "Les réponses de l'API et les pochettes sont mises en cache sur disque, avec une politique d'expiration et d'éviction telle que la suppression du dossier ne casse jamais un run."
date: "2026-08-02"
keywords: ["architecture", "adr", "cache", "lru", "ttl", "performance"]
scope: ["docs", "architecture"]
technologies: ["Python", "Tauri"]
---

# 🎯 Contexte

La CLI actuelle n'a aucun cache : un re-run sur le même dossier repaie intégralement les appels réseau. Comme le débit est tenu par techno-scraper et non par la machine locale, c'est le coût dominant d'un run.

Deux contenus sont concernés : les réponses de l'API et les pochettes téléchargées pendant la phase réseau, écrites plus tard lors de la phase locale.

---

# 🧩 Problème

Faut-il un cache, et selon quelle politique d'expiration et de taille, sachant que les métadonnées d'un morceau peuvent être corrigées à la source ?

---

# 🛠️ Options Envisagées

## Option A : Cache disque avec TTL 30 jours et plafond 500 Mo en éviction LRU

**Description :** Réponses de l'API et artworks mis en cache dans `appLocalDataDir()`. Une entrée expire au bout de 30 jours ; au-delà de 500 Mo, les entrées les moins récemment utilisées sont évincées.

**Avantages :**
- Un re-run sur le même dossier ne repaie pas le réseau, ce qui rend les itérations de réglage des seuils supportables
- Les pochettes sont déjà là au moment de l'écriture, qui reste locale et rapide
- Le plafond borne l'empreinte disque sans intervention
- Le TTL laisse les corrections faites à la source finir par arriver

**Inconvénients :**
- Une correction de métadonnées côté Beatport peut mettre jusqu'à 30 jours à être vue
- Deux politiques à implémenter et à tester (expiration et éviction)
- Un dossier de plus à purger et à exposer dans les Settings

**Coût estimé :** Faible.

## Option B : Aucun cache

**Description :** Comme la CLI actuelle, chaque run repaie tout.

**Avantages :**
- Aucune donnée périmée possible, jamais
- Rien à implémenter, rien à purger

**Inconvénients :**
- Chaque itération de réglage des seuils coûte un run réseau complet
- Charge inutile sur techno-scraper, seul facteur limitant
- Les pochettes seraient retéléchargées à chaque tentative

**Coût estimé :** Nul en code, coûteux à l'usage.

## Option C : Cache permanent, sans expiration

**Description :** Conserver indéfiniment, avec purge manuelle uniquement.

**Avantages :**
- Économie réseau maximale
- Politique triviale

**Inconvénients :**
- Une métadonnée fausse mise en cache le reste **définitivement**, sans que l'utilisateur comprenne pourquoi un re-tag ne corrige rien
- Empreinte disque non bornée, notamment à cause des pochettes
- Le bouton « vider le cache » deviendrait l'étape obligatoire de tout dépannage

**Coût estimé :** Faible en code, mauvais en usage.

---

# 🎉 Décision

**Cache disque avec TTL 30 jours, plafond 500 Mo, éviction LRU, et un bouton « vider le cache » dans les Settings.**

Le principe directeur prime sur les valeurs : **le dossier de cache est jetable par définition**. Le supprimer à tout moment, y compris en plein run, ne doit jamais rien casser, seulement des appels réseau à repayer. Toute optimisation qui violerait cette propriété est refusée.

Les valeurs retenues sont des points de départ raisonnables, pas des vérités mesurées : 30 jours parce qu'une correction de métadonnées à la source n'est pas urgente, 500 Mo parce que les pochettes dominent l'empreinte.

---

# 🔄 Conséquences

## Positives

- Un re-run sur le même dossier est quasi instantané côté réseau, ce qui rend le calibrage des seuils praticable
- La phase d'écriture reste locale et courte, les pochettes étant déjà présentes
- L'empreinte disque est bornée sans intervention de l'utilisateur
- Le cache ne peut jamais être une cause de panne, seulement de lenteur

## Négatives

- Une correction de métadonnées côté source met jusqu'à 30 jours à devenir visible, sauf vidage manuel
- Deux politiques (TTL et LRU) à implémenter et à tester
- Le bouton « vider le cache » devient un réflexe de dépannage à documenter
- Les valeurs 30 jours et 500 Mo ne sont adossées à aucune mesure et pourront s'avérer mal calibrées

---

# 📝 Notes complémentaires

Le cache vit dans `appLocalDataDir()`, comme le plan de run, mais avec un cycle de vie indépendant : la purge des plans (cf. [ADR-010](010-ecriture-batch-et-plan-de-run.md)) ne touche pas au cache, et le vidage du cache ne touche pas aux plans.

Le cache atténue la dépendance réseau sur un re-run, mais ne constitue pas un mode hors ligne : un premier passage sur un dossier neuf exige l'API (cf. [ADR-006](006-scraping-delegue-techno-scraper.md)).
