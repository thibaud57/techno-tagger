---
title: "ADR-016 — Jeu de clés nommées côté techno-scraper"
status: "accepted"
description: "techno-scraper compare aujourd'hui contre une clé unique. Passage à un jeu de clés nommées chargé depuis l'environnement, pour rendre chaque clé révocable individuellement. Chantier porté par techno-scraper, formalisé dans un brief."
date: "2026-08-29"
keywords: ["architecture", "adr", "api-key", "securite", "techno-scraper"]
scope: ["docs", "architecture"]
technologies: ["FastAPI", "Pydantic Settings", "Python", "techno-scraper"]
---

# 🎯 Contexte

La décision d'une **clé API distincte et révocable par utilisateur** est actée côté application (cf. [ADR-012](012-securite-cle-api-keyring.md)). Elle suppose que l'API sache distinguer plusieurs clés.

L'inspection de [`core/security.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/security.py) montre le mécanisme actuel : une garde globale fail-closed, `/health` étant la seule route publique, et une comparaison en temps constant contre une valeur unique.

```python
if key is None or not secrets.compare_digest(key.encode(), settings.api_key.encode()):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key")
```

Côté [`core/config.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/config.py), `api_key` est un `RequiredSecret` contraint au motif `^[\x21-\x7e]+$` : ASCII imprimable sans espace, parce que Starlette décode les en-têtes en latin-1 alors que la configuration est lue en UTF-8.

L'API est **déjà en production et versionnée en SemVer**, ce qui engage sa compatibilité.

---

# 🧩 Problème

Comment passer d'une clé unique à un jeu de clés nommées, révocables individuellement, sans casser la compatibilité d'une API déjà en production ?

---

# 🛠️ Options Envisagées

## Option A : Jeu de clés nommées en variable d'environnement

**Description :** Un réglage `api_keys` chargé depuis l'environnement associe un nom à une clé. La garde parcourt le jeu, et le nom correspondant est attaché à la requête pour les logs.

**Avantages :**
- Changement localisé : un champ dans `Settings`, une boucle dans `verify_api_key`
- Aucune infrastructure supplémentaire, cohérent avec un déploiement 12-factor déjà en place
- La révocation est une modification de variable d'environnement suivie d'un redémarrage
- Le nom rend les logs attribuables, ce qui permet d'identifier qui sature l'API
- Le motif `ApiKey` existant se réutilise tel quel sur chaque valeur du jeu

**Inconvénients :**
- Révoquer impose un redémarrage du service
- La variable devient peu lisible au-delà d'une poignée de clés
- Aucune trace de la date de création ni de la dernière utilisation

**Coût estimé :** Quelques heures.

## Option B : Table de clés en base

**Description :** Les clés vivent dans un stockage persistant, avec nom, date de création, état et éventuellement quota.

**Avantages :**
- Révocation à chaud, sans redémarrage
- Traçabilité complète, quotas par clé possibles

**Inconvénients :**
- **Introduit une dépendance de stockage dans une API qui n'en a aucune aujourd'hui**, avec sauvegarde, migrations et exploitation à la clé
- Interface d'administration à prévoir, ou manipulation directe en base
- Surdimensionné pour la dizaine d'utilisateurs attendue

**Coût estimé :** Plusieurs jours, plus l'exploitation.

## Option C : Statu quo, clé unique partagée

**Description :** Tous les utilisateurs reçoivent la même clé.

**Avantages :**
- Aucun changement sur une API en production

**Inconvénients :**
- **Contredit [ADR-012](012-securite-cle-api-keyring.md)** : une clé compromise ne se révoque que pour tout le monde
- Aucune attribution possible des appels
- Un ami qui partage la clé par mégarde ouvre l'accès à n'importe qui

**Coût estimé :** Nul, au prix de la décision déjà prise.

---

# 🎉 Décision

**Jeu de clés nommées en variable d'environnement (option A).**

Le volume attendu, **une dizaine d'utilisateurs**, ne justifie pas d'introduire un stockage persistant dans une API qui n'en a pas et se déploie aujourd'hui sans état. C'est aussi la limite du modèle : une variable d'environnement reste lisible à dix entrées, elle cesserait de l'être bien avant la centaine, et c'est ce seuil qui rouvrirait l'option B.

**Le chantier appartient à techno-scraper**, qui le traitera comme une évolution de son propre backlog. Côté techno-tagger, rien à faire ni à attendre : l'application est conçue dès le MVP pour qu'un utilisateur saisisse sa clé (cf. [ADR-012](012-securite-cle-api-keyring.md)), et elle envoie ce qu'on lui donne en header, indifférente à la façon dont l'API le vérifie.

La demande est transmise et suivie dans [techno-scraper#73](https://github.com/thibaud57/techno-scraper/issues/73), qui porte le cahier des charges complet : format retenu, invariants à ne pas casser, cas limites, tests attendus et docs à reprendre. **L'identifiant du jeu est non nominatif** (`user-1`, `user-2`…), la correspondance vers les personnes restant hors du déploiement : un prénom serait la seule donnée nominative de la chaîne et remonterait chez Sentry par la `LoggingIntegration` du SDK, ce que l'[ADR-014](014-observabilite-sentry-et-rgpd.md) exclut.

Points de mise en œuvre retenus :

- **Comparaison en temps constant conservée sur chaque candidat.** La boucle sort dès qu'une clé correspond ; le canal auxiliaire résiduel révèle au mieux la position d'une clé dans le jeu, sans intérêt pour un attaquant qui ne connaît aucune clé.
- **Le motif `ApiKey` s'applique à chaque valeur du jeu**, la contrainte latin-1 des en-têtes valant pour toutes.
- **Le nom de la clé est attaché à la requête** et repris dans les logs, jamais dans les réponses.
- **`api_key` reste accepté en repli** le temps d'une version mineure, ce qui évite une rupture sur une API en production et permet de migrer le déploiement sans fenêtre d'indisponibilité. Sa suppression appelle une version majeure.
- Le comportement fail-closed et l'exclusion de `/health` sont inchangés, tout comme le **403** rendu sur clé invalide.

---

# 🔄 Conséquences

## Positives

- Une clé compromise se coupe sans affecter les autres utilisateurs
- Les logs deviennent attribuables, donc exploitables pour comprendre une saturation des sémaphores (cf. [ADR-017](017-taille-pool-concurrence.md))
- Un rate limiting par clé devient possible si le besoin apparaît
- La migration se fait sans rupture grâce au repli sur `api_key`

## Négatives

- Chaque révocation impose un redémarrage du service
- Une clé à générer et à transmettre à la main pour chaque nouvel utilisateur
- Le repli sur `api_key` laisse temporairement deux chemins d'authentification, donc deux cas à tester
- Aucune trace de la dernière utilisation d'une clé : une clé oubliée reste valide indéfiniment

---

# 📝 Notes complémentaires

Cet ADR concerne techno-scraper, pas techno-tagger. Il est consigné ici parce que la décision est motivée par un besoin de l'application cliente et qu'il conditionne toute distribution à plus d'une personne.

Le changement porte sur une API en production : l'ajout de `api_keys` avec repli sur `api_key` est rétrocompatible et relève d'une version mineure.
