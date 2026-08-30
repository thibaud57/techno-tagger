---
title: "ADR-007 — Client HTTP : httpx2"
status: "accepted"
description: "Choix de httpx2, fork de maintenance de httpx repris par l'équipe Pydantic, contre httpx et contre curl_cffi."
date: "2026-08-02"
keywords: ["architecture", "adr", "httpx", "httpx2", "asyncio", "http"]
scope: ["docs", "architecture"]
technologies: ["httpx2", "httpx", "curl_cffi", "Python", "asyncio"]
---

# 🎯 Contexte

Le sidecar interroge techno-scraper en asyncio, avec un pool de concurrence borné : plusieurs morceaux en vol simultanément, le débit restant tenu par l'API. Il télécharge également les pochettes pendant la phase réseau.

techno-scraper utilise déjà httpx2 côté serveur.

---

# 🧩 Problème

Quel client HTTP asynchrone retenir pour appeler une API sous contrôle, avec un pool de concurrence borné ?

---

# 🛠️ Options Envisagées

## Option A : httpx2

**Description :** Fork de maintenance de httpx, repris par l'équipe Pydantic, à l'API strictement identique.

**Avantages :**
- API identique à httpx : aucune réécriture, aucune courbe d'apprentissage
- Maintenance active sous une équipe identifiée et solide
- Déjà en place sur techno-scraper, donc une seule bibliothèque HTTP à connaître sur les deux projets
- Support asyncio natif, pool de connexions configurable

**Inconvénients :**
- Fork récent : moins d'antériorité, écosystème de tutoriels encore rattaché au nom d'origine
- Dépendance à la continuité de l'engagement de l'équipe Pydantic

**Coût estimé :** Nul.

## Option B : httpx

**Description :** Le projet d'origine.

**Avantages :**
- Antériorité, documentation et écosystème les plus larges
- Nom reconnu, réponses abondantes sur les cas tordus

**Inconvénients :**
- C'est précisément la baisse de maintenance qui a motivé le fork
- Introduirait une divergence avec techno-scraper sans raison

**Avantage décisif à ne pas sous-estimer :** tout l'outillage de mock HTTP ne fonctionne que sur lui. `respx` déclare `httpx>=0.25.0` et `pytest-httpx` déclare `httpx==0.28.*` : leurs PR de support de httpx2 sont ouvertes et non mergées. L'API des deux clients est bien identique, mais l'écosystème de test, lui, ne l'est pas.

**Coût estimé :** Nul, mais avec un risque de maintenance.

## Option C : curl_cffi

**Description :** Client HTTP imitant l'empreinte TLS d'un navigateur, utilisé pour contourner les protections anti-bot.

**Avantages :**
- Contourne les anti-bots basés sur l'empreinte TLS
- Utile face à Cloudflare et équivalents

**Inconvénients :**
- **Sans objet ici** : l'application appelle sa propre API, pas un site protégé. Le scraping est délégué à techno-scraper (cf. [ADR-006](006-scraping-delegue-techno-scraper.md)).
- Dépendance native à embarquer dans le binaire PyInstaller, avec les complications de packaging associées
- API plus éloignée de httpx, donc du code à adapter

**Coût estimé :** Non nul, pour un besoin inexistant.

---

# 🎉 Décision

**httpx2.**

L'API étant strictement identique à celle de httpx, le choix se joue sur deux critères : la maintenance, à laquelle le fork est précisément la réponse, et l'outillage de test, où httpx garde l'avantage. L'alignement avec techno-scraper tranche en faveur de httpx2, au prix documenté ci-dessous.

curl_cffi est écarté par le périmètre : l'application n'affronte aucun anti-bot, c'est le rôle de techno-scraper.

---

# 🔄 Conséquences

## Positives

- Une seule bibliothèque HTTP à connaître entre techno-scraper et techno-tagger
- Pool de connexions et concurrence asyncio disponibles nativement
- Aucune dépendance native à empaqueter dans le binaire PyInstaller

## Négatives

- Dépendance à un fork jeune, dont la trajectoire dépend d'une équipe tierce
- Les recherches d'aide portent souvent le nom du projet d'origine, avec un risque de réponses décalées sur les cas limites
- **Aucun outil de mock HTTP ne le supporte** : `respx` et `pytest-httpx` sont épinglés sur httpx, leurs PR de support ouvertes et non mergées. Le client techno-scraper mocké prévu par la stratégie de tests passe donc par le `MockTransport` natif d'httpx2, injecté dans le client. C'est quelques dizaines de lignes de fixture, et ce choix doit être fait **avant** le premier test réseau, pas après

---

# 📝 Notes complémentaires

La taille du pool de concurrence n'est pas fixée par ce choix : elle dépend de ce que techno-scraper encaisse, et reste à mesurer (cf. [ADR-017](017-taille-pool-concurrence.md)).
