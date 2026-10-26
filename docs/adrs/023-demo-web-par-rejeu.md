---
title: "ADR-023 — Démo web publique par rejeu d'un run enregistré"
status: "accepted"
description: "La démo web rejoue dans le navigateur les réponses NDJSON du vrai sidecar, enregistrées sur une bibliothèque fictive face à un faux techno-scraper. Données fictives de bout en bout, garde stricte en CI, container statique isolé déployé au tag."
date: "2026-10-25"
keywords: ["architecture", "adr", "demo", "rejeu", "ndjson", "dokploy", "donnees-fictives"]
scope: ["docs", "architecture"]
technologies: ["Python", "Angular", "Tauri", "Dokploy", "GitHub Actions", "Pyodide"]
---

# 🎯 Contexte

Le portfolio du propriétaire veut un bouton « Voir la démo » qui ouvre l'application dans un navigateur, sur un sous-domaine dédié. L'application est une coquille Tauri dont tout le métier vit dans un sidecar Python empaqueté pour Windows, relié à l'interface par le protocole NDJSON (cf. [ADR-005](005-sidecar-python-protocole-ndjson.md)). L'interface parle au sidecar par un transport injectable (`SIDECAR_TRANSPORT`).

Le sidecar ne tourne pas dans un navigateur : il appelle techno-scraper avec une clé API par utilisateur. Le dépôt est public (cf. [ADR-021](021-visibilite-du-depot.md)) et rien de personnel ne doit quitter la machine d'un utilisateur (cf. [ADR-014](014-observabilite-sentry-et-rgpd.md)). Une démo publique, ouverte à n'importe quel visiteur, ne peut donc ni embarquer de clé ni envoyer de saisie visiteur vers un service.

L'étude de faisabilité date du 2026-10-25. Les décisions datées qui en découlent sont consignées dans `docs/BRAINSTORM.md` § Notes.

---

# 🧩 Problème

Comment montrer l'application complète à un visiteur anonyme, sans exposer techno-scraper, sans clé API, sans réécrire le métier en TypeScript et sans republier de données Beatport ?

---

# 🛠️ Options Envisagées

## Option A : Rejeu d'un run enregistré

**Description :** Le vrai sidecar joue chaque branche du parcours sur une bibliothèque fictive, face à un faux techno-scraper, dans un enregistreur lancé sous Windows. Les réponses NDJSON sont écrites dans un scénario versionné. En démo, un transport de rejeu remplace `SIDECAR_TRANSPORT` et sert ces réponses à l'interface. Le serveur ne sert que des fichiers statiques.

**Avantages :**
- Tout le métier reste dans le sidecar : la démo montre ce qu'il émet réellement, pas une réécriture
- Aucun sidecar ni clé API côté serveur, aucun appel à techno-scraper : le visiteur ne peut rien envoyer
- Le transport est déjà une frontière injectable, le rejeu s'y branche sans toucher aux écrans
- Hébergement réduit à un container de fichiers statiques

**Inconvénients :**
- Le visiteur suit un parcours borné : les saisies libres (URL, seuils) hors scénario ne sont pas jouées
- Le scénario est une copie du comportement du sidecar : il faut le garder par un test
- Chaque branche rejouable multiplie les combinaisons à enregistrer

**Coût estimé :** Un enregistreur côté sidecar, un transport de rejeu côté interface, une image statique. Pas de service à exploiter.

## Option B : Sidecar sur le serveur derrière un WebSocket

**Description :** Le sidecar tourne sur le VPS et l'interface lui parle par un WebSocket.

**Avantages :**
- Comportement réel à chaque session, saisies libres comprises

**Inconvénients :**
- Exige la clé API sur le serveur et expose au public un proxy vers techno-scraper
- Sidecar Windows only (cf. [ADR-015](015-cibles-distribution-windows.md)) : un build Linux à créer et à maintenir
- Un service exposé à exploiter, à isoler et à limiter en débit

**Coût estimé :** Élevé, en exploitation permanente et en surface d'attaque.

## Option C : Sidecar dans le navigateur par Pyodide

**Description :** Le sidecar est exécuté dans CPython compilé vers WebAssembly, au sein d'un Web Worker (Pyodide 314.0.7, relevé le 2026-10-25).

**Avantages :**
- Aucun serveur applicatif, comportement réel côté client

**Inconvénients :**
- Pas de wheel `rapidfuzz` pour Pyodide, or le matching en dépend
- Les threads ne fonctionnent pas, alors que le sidecar repose sur `asyncio.to_thread`
- Il resterait à fournir un faux techno-scraper joignable depuis le navigateur

**Coût estimé :** Élevé et incertain, avec un portage du sidecar au lieu d'une réutilisation.

## Option D : `mockIPC` de Tauri

**Description :** Les commandes Tauri sont simulées par le `mockIPC` de `@tauri-apps/api/mocks`.

**Avantages :**
- Outil officiel, rien à écrire pour intercepter les appels

**Inconvénients :**
- C'est un outil de test, plus bas niveau que `SIDECAR_TRANSPORT` : il simule l'IPC Tauri, donc la couche sous le transport que l'application possède déjà
- Il ne fournit ni scénario ni réponses : tout reste à produire

**Coût estimé :** Équivalent à A pour les réponses, avec une couche de plus à maîtriser.

---

# 🎉 Décision

**Option A : rejeu d'un run enregistré.**

B est écartée parce qu'elle exigerait la clé API et ferait d'un serveur public un proxy vers techno-scraper, sur un sidecar qui n'existe que sous Windows. C est écartée parce que `rapidfuzz` n'a pas de wheel pour Pyodide et que les threads dont dépend `asyncio.to_thread` n'y fonctionnent pas. D est écartée parce que `SIDECAR_TRANSPORT` offre déjà, au bon niveau, la coupure que `mockIPC` simulerait plus bas.

A garde tout le métier dans le sidecar et ne laisse que des fichiers statiques sur le serveur. Quatre décisions la complètent.

**Données fictives de bout en bout.** Les CGU de Beatport (relevé du 2026-10-25) rangent métadonnées et pochettes dans leur « Content », réservé à un usage personnel non commercial. Le catalogue est donc inventé et les pochettes sont générées. Des métadonnées inventées sur de vrais morceaux seraient en outre trompeuses, sans aucun gain pour le public du portfolio. Aucun domaine réel n'apparaît dans le scénario : les URLs sont sur `.example` et le harnais remplace `_BANDCAMP_HOST` pour que le rattrapage par URL accepte `*.bandcamp.example`, un sous-domaine fictif de `bandcamp.com` restant un domaine réel que n'importe qui peut enregistrer.

**Garde stricte.** Le scénario est une copie du comportement du sidecar : une copie se garde par un test, jamais par la vigilance. La CI réenregistre et compare. Elle casse en nommant la réponse en cause dès qu'un changement du sidecar modifie une réponse enregistrée. La garde tourne sur le runner `windows-2025` du job sidecar, aucun autre OS n'est ciblé. Une garde souple (validité contre le protocole seulement) laisserait la démo datée sans rien signaler.

**Isolation et hébergement.** Le projet Dokploy `techno-tagger`, en environment `demo`, déploie le container en Isolated Deployment. Un projet Dokploy n'isole rien par lui-même : l'isolation vient de l'Isolated Deployment. Le réseau du portfolio est précisément ce que la démo ne doit pas voir.

**Build au tag.** L'image est construite par la CI au tag et poussée sur GHCR. Aucun build ne tourne sur le VPS de l'API, la clé PrimeNG est déjà un secret GitHub et le déploiement est déclenché par le tag. Le scénario et les pochettes vivent dans `src/demo/`, branché dans les seuls assets de la configuration `demo` : rien de la démo n'entre dans l'installeur.

---

# 🔄 Conséquences

## Positives

- Le visiteur voit le vrai comportement du sidecar, sans clé, sans compte et sans appel à techno-scraper
- Aucun service applicatif à exploiter : un container de fichiers statiques, isolé du réseau du portfolio
- Aucune donnée ni pochette de Beatport ou de Bandcamp republiée, aucun vrai artiste associé à des métadonnées inventées
- Le dépôt public reste sans secret et sans ligne de scraping (cf. [ADR-021](021-visibilite-du-depot.md)). Rien de personnel ne sort (cf. [ADR-014](014-observabilite-sentry-et-rgpd.md))
- L'installeur desktop reste inchangé

## Négatives

- **Exception voulue à la règle No-lib-test** : la garde stricte rougit aussi sur une montée de rapidfuzz, mutagen ou pydantic qui change une réponse, sans régression de notre code. C'est le même type d'exception que la garde `data_collection` (cf. [ADR-014](014-observabilite-sentry-et-rgpd.md)). Procédure : réenregistrer sous Windows (`just record-demo`), relire le diff de `src/demo/` et le commiter dans la PR de la montée
- L'enregistrement n'est possible que sous Windows (un cas de la démo repose sur un fichier verrouillé) : l'enregistreur échoue d'emblée ailleurs
- Chaque changement de comportement du sidecar coûte une commande et un commit de `src/demo/`
- Le parcours est borné : le rattrapage par URL n'est joué que sur un morceau, lien pré-rempli, parce que chaque morceau rattrapable multiplie les combinaisons à enregistrer

---

# 📝 Notes complémentaires

Les options B, C et D ont été comparées pendant l'étude de faisabilité du 2026-10-25. Les décisions détaillées (données, build, hébergement, rattrapage, bandeau) sont datées dans `docs/BRAINSTORM.md` § Notes. Le bandeau de la démo renvoie vers un lien « Me contacter » et jamais vers un téléchargement : l'application est privée et le portfolio reste le point de contact.

Le catalogue fictif est vérifié par une recherche Beatport et Discogs avant enregistrement : aucun nom d'artiste ou de label ne doit désigner un vrai artiste ou label. Le résultat et sa date sont consignés en tête du module du catalogue. Le nombre de morceaux, de combinaisons et de sessions enregistrés est relevé dans le scénario versionné, pas dans ce document.

Référence : [Pyodide](https://pyodide.org/), [Tauri v2 : Mock Tauri APIs](https://v2.tauri.app/develop/tests/mocking/).
