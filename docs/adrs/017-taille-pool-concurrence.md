---
title: "ADR-017 — Taille du pool de concurrence"
status: "accepted"
description: "Le pool client reflète les sémaphores de concurrence sortante de techno-scraper (Beatport 3, Bandcamp 2), au-delà desquels les requêtes s'empilent et consomment le budget de timeout de l'API."
date: "2026-08-02"
keywords: ["architecture", "adr", "concurrence", "asyncio", "performance", "semaphore"]
scope: ["docs", "architecture"]
technologies: ["asyncio", "httpx2", "Python", "techno-scraper"]
---

# 🎯 Contexte

Le sidecar traite les morceaux en pool asyncio borné. Un run type compte 100 morceaux, chacun déclenchant un appel Beatport, éventuellement un appel Bandcamp, et un téléchargement de pochette.

L'inspection de techno-scraper a rendu cette question déductible plutôt que mesurable. [`core/limits.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/limits.py) borne déjà la concurrence **sortante** par source avec des sémaphores :

```python
_MAX_CONCURRENCY: dict[Source, int] = {
    Source.BANDCAMP: 2,
    Source.BEATPORT: 3,
    Source.SOUNDCLOUD: 5,
}
```

Le commentaire du module en donne la raison : « L'API est le point de sortie IP unique : une rafale d'un consommateur fait bannir *notre* IP, donc tous les consommateurs. »

Trois autres valeurs de [`core/config.py`](https://github.com/thibaud57/techno-scraper/blob/HEAD/src/technoscraper/core/config.py) complètent le tableau : `http_timeout: 15`, `http_max_retries: 3` (un fetch peut donc durer une soixantaine de secondes) et `request_timeout: 90`, au-delà duquel un `TimeoutMiddleware` rend un **504**, attente derrière le sémaphore comprise.

---

# 🧩 Problème

Quelle taille de pool retenir côté client, sachant que l'API borne déjà la concurrence en sortie et coupe à 90 secondes ?

---

# 🛠️ Options Envisagées

## Option A : Pool client aligné sur les sémaphores de l'API, par source

**Description :** 3 requêtes Beatport en vol maximum, 2 pour Bandcamp, en miroir exact de `_MAX_CONCURRENCY`.

**Avantages :**
- **Borne la file de l'API, pas seulement la sienne** : un client qui n'a que 3 requêtes en vol ne peut pas y empiler ses 100 morceaux. À cinq utilisateurs simultanés, l'API voit 15 requêtes au pire, pas 500, et l'attente derrière le sémaphore reste de quelques secondes au lieu de dépasser le budget de 90 secondes
- Ce qui se dégrade à plusieurs est le **débit**, jamais le taux d'échec : un run prend plus longtemps, aucun morceau ne part en erreur
- Le débit obtenu est exactement le débit maximal que l'API peut délivrer : au-delà, il n'y a rien à gagner
- Protège l'IP de sortie partagée, ce qui est l'objectif même du sémaphore côté API
- Valeur justifiable par lecture du code, pas par supposition

**Inconvénients :**
- Deux constantes à garder synchronisées avec un autre dépôt, sans mécanisme de vérification
- Ignore la concurrence des autres utilisateurs : à deux runs simultanés, les sémaphores sont saturés et l'attente réapparaît

**Coût estimé :** Nul.

## Option B : Pool client supérieur, en pariant sur le débit

**Description :** 5 à 10 requêtes en vol, comme les `THREADS_NUMBER = 5` de la CLI.

**Avantages :**
- Aucune connaissance de l'API nécessaire
- Absorberait un relèvement des sémaphores côté API sans changement client

**Inconvénients :**
- **Ne gagne strictement rien** : les requêtes excédentaires attendent derrière le sémaphore
- **Fabrique des 504** : chaque requête en attente consomme son budget de 90 secondes, et une file suffisamment longue le dépasse
- Un 504 est indiscernable d'une vraie panne de l'API dans les logs et le rapport
- La CLI utilisait 5 threads contre du scraping direct, sans API intermédiaire ni sémaphore : la valeur n'est pas transposable

**Coût estimé :** Nul en code, coûteux en faux échecs.

## Option C : Valeur configurable dans les Settings

**Description :** Un réglage exposé à l'utilisateur.

**Avantages :**
- Ajustable sans nouvelle version

**Inconvénients :**
- Expose un réglage dont la bonne valeur est écrite dans le code d'un serveur que l'utilisateur ne voit pas
- Un ami qui la monte pour « aller plus vite » ne gagne rien et se fabrique des 504
- Un réglage de plus à traduire, documenter et tester

**Coût estimé :** Faible en code, nuisible en usage.

---

# 🎉 Décision

**Pool client aligné sur les sémaphores de l'API : 3 pour Beatport, 2 pour Bandcamp.**

La valeur n'était pas à mesurer, elle est écrite dans `_MAX_CONCURRENCY`. Tout dépassement est du travail perdu qui se transforme en 504.

Deux règles complémentaires en découlent :

- **Timeout client supérieur au `request_timeout` de l'API**, de l'ordre de 100 secondes. Couper plus tôt côté client priverait du 504 structuré que l'API rend avec son `request_id`, et ferait passer une saturation pour une panne réseau locale.
- **Un 504 n'est pas retryé immédiatement.** Il signale une file saturée ; réessayer sur-le-champ l'aggrave. Le morceau part en erreur, visible dans le rapport.

---

# 🔄 Conséquences

## Positives

- Débit maximal atteignable sans jamais attendre derrière un sémaphore
- Un run de 100 morceaux tient dans quelques minutes, borné par la latence réelle de l'API
- L'IP de sortie partagée est protégée, ce qui bénéficie à tous les utilisateurs
- Le comportement est identique chez tout le monde, donc reproductible en cas de problème

## Négatives

- Deux constantes dupliquées entre deux dépôts, sans mécanisme de synchronisation : un relèvement côté API ne profite pas au client tant qu'il n'est pas reporté à la main
- À deux runs simultanés, les sémaphores sont saturés et l'attente réapparaît, sans que le client puisse le détecter autrement que par la latence
- Les valeurs sont celles d'aujourd'hui : elles sont justes tant que `_MAX_CONCURRENCY` ne bouge pas

---

# 📝 Notes complémentaires

La CLI utilisait `THREADS_NUMBER = 5` et tolérait bien plus, valeurs sans rapport avec ce contexte : elle scrapait Beatport **depuis la machine et l'IP de l'utilisateur**. Une rafale ne pénalisait que lui. Ici l'IP de sortie est partagée, et la même rafale ferait bannir le service pour tout le monde. La perte de débit n'est donc pas une régression mais le prix de la mutualisation.

Le sémaphore Bandcamp à 2 est adossé à une observation documentée dans les connaissances de techno-scraper, un 429 dès 3 à 4 requêtes concurrentes. **Celui de Beatport à 3 ne l'est pas** : rien n'indique que cette source soit aussi sensible. C'est donc le premier levier à mesurer si le débit devient gênant à plusieurs utilisateurs, et le relever profiterait à tous les clients à la fois.

Une piste pour supprimer la duplication, hors périmètre MVP : exposer les valeurs de concurrence dans une route de l'API (par exemple `/health` ou une route de capacités), que le client lirait au démarrage. Cela transformerait deux constantes dupliquées en un contrat explicite.

Le téléchargement des pochettes a son propre pool, distinct de celui des requêtes API, sa taille fixée à **6**. Ce n'est pas une contrainte de sémaphore côté techno-scraper comme les valeurs ci-dessus : les CDN de pochettes ne sont pas concernés par `_MAX_CONCURRENCY`, c'est un calibrage libre.

Le cache disque (cf. [ADR-013](013-cache-disque-jetable.md)) supprime la charge d'un re-run, mais ne change rien au premier passage sur un dossier neuf, qui est le cas dimensionnant.
