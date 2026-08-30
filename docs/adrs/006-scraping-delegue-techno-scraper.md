---
title: "ADR-006 — Scraping délégué à techno-scraper"
status: "accepted"
description: "L'application ne scrape rien elle-même : toute donnée vient de l'API techno-scraper, seule surface à réparer quand un site change de structure."
date: "2026-08-02"
keywords: ["architecture", "adr", "scraping", "api", "beatport", "bandcamp"]
scope: ["docs", "architecture"]
technologies: ["techno-scraper", "httpx2", "Python"]
---

# 🎯 Contexte

La CLI actuelle scrape Beatport directement, et casse à chaque changement de structure du site. Elle n'a par ailleurs qu'une seule source : quand Beatport ne connaît pas un titre, le fichier reste tel quel.

L'API [techno-scraper](https://techno-scraper.empiricmind.fr) existe et tourne en production. Elle expose Beatport, Bandcamp et SoundCloud derrière un contrat `Track` normalisé, protégée par un header `X-API-Key`.

Son [ADR-002](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md) pose explicitement qu'elle ne fait ni fallback ni matching : cette logique appartient à ses consommateurs.

---

# 🧩 Problème

L'application doit-elle intégrer sa propre couche de scraping, ou déléguer intégralement la récupération des données à techno-scraper ?

---

# 🛠️ Options Envisagées

## Option A : Tout déléguer à techno-scraper

**Description :** L'application n'appelle que l'API. Aucun code de scraping, aucun parsing HTML, aucune gestion d'anti-bot.

**Avantages :**
- **Une seule surface à réparer** quand Beatport ou Bandcamp change de structure : l'API, pas les installations déjà distribuées chez les amis
- L'API existe déjà et tourne en production, avec un contrat `Track` normalisé qui uniformise Beatport et Bandcamp
- Une correction côté API bénéficie immédiatement à tous les utilisateurs, sans mise à jour de l'application
- Pas de dépendance anti-bot (curl_cffi, navigateur headless) dans un binaire distribué
- Le binaire distribué ne contient aucune logique de scraping

**Inconvénients :**
- L'application ne fonctionne pas sans réseau ni sans API disponible
- Dépendance à la disponibilité d'un VPS et à sa latence
- Chaque utilisateur doit disposer d'une clé API, donc d'une gestion de clés à mettre en place
- Le débit est plafonné par l'API, pas par la machine locale

**Coût estimé :** Nul, l'API existe.

## Option B : Scraping intégré à l'application

**Description :** Porter le scraping Beatport de la CLI dans le sidecar, et y ajouter Bandcamp.

**Avantages :**
- Aucune dépendance à un service distant, aucune clé à gérer
- Pas de plafond de débit imposé par un tiers

**Inconvénients :**
- **Chaque changement de structure de Beatport casse toutes les installations déjà distribuées**, et impose de rediffuser l'application à tout le monde
- Deux sources à scraper au lieu d'une à appeler, avec leurs anti-bots respectifs
- Duplique un travail déjà fait et déployé
- Un binaire distribué contenant du code de scraping est plus exposé qu'une application qui consomme une API générique

**Coût estimé :** Élevé, et récurrent.

---

# 🎉 Décision

**Tout déléguer à techno-scraper.**

Le critère décisif est le coût de la réparation. En intégré, un changement de structure de Beatport rend inutilisables toutes les copies installées jusqu'à ce qu'une nouvelle version soit construite, signée, publiée et téléchargée par chacun. En délégué, la même panne se corrige sur le VPS et disparaît pour tout le monde sans que personne ne mette à jour quoi que ce soit.

L'API ne faisant ni fallback ni matching par conception, l'enchaînement des sources et le scoring restent la responsabilité de l'application (cf. [ADR-008](008-matching-rapidfuzz-et-agent-ia.md) et [ADR-009](009-enchainement-sources-et-arbitrage.md)).

---

# 🔄 Conséquences

## Positives

- Une seule surface de réparation, et elle est sous contrôle direct
- Les corrections se propagent sans mise à jour de l'application
- Le contrat `Track` normalisé donne un modèle unique quelle que soit la source
- Aucune dépendance anti-bot embarquée dans le binaire distribué

## Négatives

- L'application est inutilisable si l'API est injoignable, et n'a aucun mode dégradé de récupération de métadonnées
- Le VPS devient un point de défaillance unique pour tous les utilisateurs
- Une gestion de clés API individuelles devient nécessaire (cf. [ADR-012](012-securite-cle-api-keyring.md) et [ADR-016](016-multi-cles-techno-scraper.md))
- Le débit d'un run est borné par ce que l'API encaisse, ce qui impose un pool de concurrence mesuré (cf. [ADR-017](017-taille-pool-concurrence.md))

---

# 📝 Notes complémentaires

Le module `scraper_client.py` isole le contrat de l'API du reste du métier : un changement de version de techno-scraper ne doit toucher qu'un fichier.

Le cache disque atténue partiellement la dépendance réseau sur un re-run du même dossier, mais ne constitue pas un mode hors ligne (cf. [ADR-013](013-cache-disque-jetable.md)).

Références : [techno-scraper — README](https://github.com/thibaud57/techno-scraper/blob/HEAD/README.md), [techno-scraper — ADR-002](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/002-api-gateway-bas-niveau.md), [techno-scraper — ADR-006](https://github.com/thibaud57/techno-scraper/blob/HEAD/docs/adrs/006-schema-track-normalise.md).
