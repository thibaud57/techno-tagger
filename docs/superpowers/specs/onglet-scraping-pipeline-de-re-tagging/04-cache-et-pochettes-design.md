---
feature: "Feature 2 — Onglet Scraping, pipeline de re-tagging"
subproject: "cache-et-pochettes"
goal: "Mettre en cache disque les réponses de l'API et les pochettes téléchargées, avec expiration et plafond de taille"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: ["02-client-techno-scraper-design.md"]
date: "2026-09-19"
---

# Cache disque des réponses et des pochettes

## Scope

Couvre le cache disque du sidecar dans le répertoire de données de l'application : réponses réussies de techno-scraper et pochettes téléchargées, TTL de 30 jours, plafond de 500 Mo en éviction LRU, tolérance totale à un dossier supprimé ou corrompu (ADR-013). Couvre aussi le téléchargement des pochettes depuis le CDN de la source en pool de 6 (ADR-017), le branchement du cache dans le client du sub-project 02, et l'extraction de la racine des données de l'application dans un module unique, partagé avec les logs.

Exclut le bouton « vider le cache » et l'affichage de sa taille dans les Settings (Feature 7), le choix de la pochette à télécharger et le log de ses échecs avec le run et le morceau (sub-project 06), la lecture des vignettes par la webview et le scope du protocole asset (sub-project 09), l'intégration de la pochette aux tags (Feature 5).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir passer une suite qui remplit le cache au-delà de son plafond et vérifie l'éviction des entrées les moins récemment lues, fait expirer une entrée après 30 jours, supprime le dossier en plein usage sans erreur, sert une seconde recherche identique sans requête réseau et télécharge une pochette une seule fois.

## Dependencies

- `02-client-techno-scraper-design.md` (statut: implemented) : fournit `TechnoScraperClient` et sa méthode privée `_get`, point de passage unique où le cache des réponses se branche.

## Files touched

- **À créer** : `sidecar/src/tagger/paths.py` (racine des données de l'application, source unique)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`log_dir()` dérivé de la racine commune)
- **À modifier** : `sidecar/src/tagger/cache.py` (remplace le placeholder : `DiskCache`, `ResponseCache`, `ArtworkFetcher`, erreurs)
- **À modifier** : `sidecar/src/tagger/scraper_client.py` (paramètre `cache` du client, lecture et écriture dans `_get`)
- **À créer** : `sidecar/tests/unit/test_cache_disk.py` (TTL, LRU, plafond, tolérances)
- **À créer** : `sidecar/tests/unit/test_cache_artworks.py` (téléchargement, extension, échecs, borne de 6)
- **À modifier** : `sidecar/tests/unit/test_scraper_client_requests.py` (réponses servies depuis le cache)
- **À créer** : `sidecar/tests/unit/test_paths.py` (racine des données de l'application ; le test existant du dossier de logs dans `test_main.py` reste inchangé et continue de passer)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.artwork_unavailable`, exigé par `test_error_translations.py`)
- **À modifier** : `docs/ARCHITECTURE.md` (§ Organisation du Code, arborescence : `paths.py`)

## Architecture approach

- **Une racine de données, une source** (CLAUDE.md § Une valeur, une source) : `app_data_dir()` dans `tagger/paths.py` rend `%LOCALAPPDATA%/<BUNDLE_IDENTIFIER>`, ce que Tauri résout comme `appLocalDataDir()`. `log_dir()` en dérive `logs/`, le cache `cache/responses/` et `cache/artworks/`. Le calcul reste côté sidecar, pour la raison déjà écrite dans `log_dir()` : le logger est armé avant la première commande NDJSON.
- **Aucun index : tout se déduit du dossier** (décision du 2026-09-19). Une entrée est un fichier `<sha256 de la clé>.<epoch d'écriture>.<extension>`. L'âge se lit dans le nom, le dernier usage dans le `mtime`, touché par `os.utime` à chaque lecture. Supprimer un fichier ou le dossier entier ne peut rien désynchroniser, ce qui est la propriété imposée par ADR-013. La date de création Windows n'est pas utilisée : le tunneling NTFS la recopie quand un fichier est recréé sous le même nom dans les secondes qui suivent sa suppression.
- **`DiskCache` générique et synchrone**, appelé par `asyncio.to_thread` depuis le code asynchrone (`.claude/rules/python/asyncio.md`) :
  - `get(key)` rend le chemin de l'entrée ou `None`. Une entrée expirée est supprimée et compte comme absente.
  - `begin(key, extension)` ouvre un `.tmp` dans le même dossier, `commit` le renomme en entrée publiée, `abort` le supprime. Au commit, une version antérieure de la même clé est supprimée, la taille totale est mise à jour, puis l'éviction s'applique. `writer(key, extension)` enchaîne les trois dans un context manager pour une écriture d'un bloc : en cas d'erreur, rien n'est publié.
  - À l'ouverture, un seul parcours du dossier supprime les `.tmp` orphelins et les entrées expirées, et calcule la taille totale.
  - TTL `timedelta(days=30)`, plafond `500 * 1000 * 1000` octets (ADR-013), horloge injectable.
- **Éviction LRU** : quand la taille totale dépasse le plafond après une écriture, les entrées au `mtime` le plus ancien sont supprimées jusqu'à repasser sous le plafond. L'entrée qui vient d'être écrite n'est jamais évincée par sa propre écriture.
- **Tolérance, le cache n'est jamais une cause d'échec** (ADR-013) : un `FileNotFoundError` sur un fichier ou un dossier disparu équivaut à un miss, le dossier est recréé à l'écriture suivante. Un JSON illisible est supprimé et compte comme un miss. Toute autre `OSError` d'écriture est loguée en WARNING avec `reason` et avalée, la réponse étant déjà en main (`.claude/rules/python/fichiers-io.md`).
- **Cache des réponses** : `ResponseCache` enveloppe un `DiskCache` sur `cache/responses/`. La clé est la route suivie des paramètres triés, après la troncature de la requête. Le client du sub-project 02 reçoit un paramètre optionnel `cache`. Dans `_get`, la lecture précède le sémaphore : un hit ne consomme aucune place du pool. Seules les réponses 2xx sont écrites, résultat vide compris : un « rien trouvé » est mémorisé 30 jours, ce qu'ADR-013 accepte (« une correction de métadonnées côté source met jusqu'à 30 jours à devenir visible »). Aucune erreur n'est mise en cache. Une réponse servie depuis le cache porte un `request_id` vide.
- **Pochettes** : `ArtworkFetcher`, context manager asynchrone, avec son propre `httpx2.AsyncClient`, sans `X-API-Key`, puisque `release.artwork_url` pointe le CDN de la source et ne traverse pas l'API (`.claude/rules/techno-scraper/contrat.md`). Timeout httpx2 par défaut, sémaphore de 6 distinct des pools de l'API (ADR-017, `.claude/rules/python/asyncio.md`), transport injectable (`.claude/rules/httpx2/client.md`).
  - `fetch(url)` rend le chemin de la pochette en cache, ou la télécharge par `stream()` en écrivant au fil d'`aiter_bytes()` dans une écriture ouverte par `begin`, chaque accès disque délégué par `asyncio.to_thread` (`.claude/rules/httpx2/client.md`, `.claude/rules/python/asyncio.md`).
  - L'extension vient du `Content-Type` : `image/jpeg` donne `.jpg`, `image/png` `.png`, `image/webp` `.webp`. Tout autre type est refusé.
  - Un échec (erreur réseau, statut non 2xx, contenu qui n'est pas une image) lève `ArtworkUnavailableError` avec un `reason`. Le pipeline l'attrape, la logue avec `run` et `track` et poursuit sans pochette : un échec de pochette ne fait jamais échouer le morceau (`.claude/rules/httpx2/client.md`). Pas de nouvelle tentative : la pochette sera retentée au run suivant.
- **Erreurs** : `ArtworkUnavailableError` hérite de `TaggerError`, `code` stable et `params` en attributs (`.claude/rules/python/gestion-erreurs.md`). L'URL n'entre pas dans les `params` : elle peut désigner une sortie, donc un titre.
- **Modèles internes** en dataclasses gelées, constantes `Final` (`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`).

## Acceptance criteria

### Scénario 1 : Entrée relue avant expiration
**GIVEN** une réponse écrite dans le cache il y a 29 jours
**WHEN** la même clé est relue
**THEN** l'entrée est rendue et son dernier usage devient l'instant de la lecture

### Scénario 2 : Entrée expirée
**GIVEN** une réponse écrite il y a 31 jours
**WHEN** la même clé est relue
**THEN** aucune entrée n'est rendue
**AND** le fichier a été supprimé

### Scénario 3 : Éviction des entrées les moins récemment lues
**GIVEN** un cache plafonné, rempli de trois entrées dont la plus ancienne vient d'être relue
**WHEN** une quatrième entrée fait dépasser le plafond
**THEN** l'entrée évincée est celle dont la dernière lecture est la plus ancienne, pas la plus ancienne écrite

### Scénario 4 : Dossier supprimé en plein usage
**GIVEN** un cache ouvert dont le dossier est supprimé par l'utilisateur
**WHEN** une clé est relue puis une entrée est écrite
**THEN** la lecture rend un miss sans erreur
**AND** l'écriture recrée le dossier

### Scénario 5 : Recherche servie depuis le cache
**GIVEN** un client branché sur un cache, et une première recherche Beatport réussie
**WHEN** la même recherche est relancée
**THEN** aucune requête n'est émise et les mêmes candidats sont rendus

### Scénario 6 : Erreur jamais mise en cache
**GIVEN** une API qui rend `503` puis `200`
**WHEN** la même recherche est lancée deux fois
**THEN** la seconde recherche émet une requête et rend les candidats

### Scénario 7 : Pochette téléchargée une seule fois
**GIVEN** un CDN qui rend une image `image/jpeg`
**WHEN** la même pochette est demandée deux fois
**THEN** une seule requête est émise
**AND** le chemin rendu se termine par `.jpg` et contient les octets de l'image

### Scénario 8 : Pochette indisponible
**GIVEN** un CDN qui rend `404`, ou `200` avec un `Content-Type` `text/html`
**WHEN** la pochette est demandée
**THEN** une `ArtworkUnavailableError` est levée
**AND** aucun fichier n'est publié dans le cache

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_cache_disk.py` :
  - returns a written entry before it expires
  - touches the last use of an entry on read
  - deletes and misses an expired entry
  - evicts the least recently read entries above the ceiling
  - never evicts the entry just written
  - computes the total size of existing entries on open
  - removes orphan temporary files on open
  - replaces the previous version of a key
  - misses without error once the folder is deleted, then recreates it on write
  - publishes nothing when the writer fails
  - deletes and misses an unreadable json response
- `sidecar/tests/unit/test_cache_artworks.py` :
  - downloads an artwork once and serves it from the cache
  - names the file after the content type (paramétré : jpeg, png, webp)
  - raises artwork unavailable on an error status
  - raises artwork unavailable on a content that is not an image
  - raises artwork unavailable on a network error
  - never keeps more than six downloads in flight
  - sends no api key to the cdn
- `sidecar/tests/unit/test_scraper_client_requests.py` (ajouts) :
  - serves a repeated search from the cache without a request
  - caches an empty result
  - never caches an error response
- `sidecar/tests/unit/test_paths.py` :
  - puts the application data folder under the bundle identifier

## Edge cases

- **Deux écritures concurrentes de la même clé** : chacune écrit son propre `.tmp`, le dernier renommage gagne, la version perdante est supprimée par l'écriture suivante ou purgée par l'expiration.
- **Horloge système reculée** : une entrée dont l'epoch est dans le futur n'est jamais considérée comme expirée avant l'heure. Le cas est borné par le plafond LRU et par le vidage manuel.
- **Pochette plus grosse que le plafond** : écrite, jamais évincée par sa propre écriture, évincée à l'écriture suivante.
- **Fichier inconnu dans le dossier** (nom hors format) : ignoré par le parcours et par l'éviction, jamais supprimé.
- **`artwork_url` absente** : le pipeline ne demande rien, aucune erreur ici.
- **Cache partagé par deux instances de l'application** : empêché par le plugin `single-instance` de Tauri, non géré ici.

## Architectural decisions

### Décision : Suivi de l'âge et du dernier usage des entrées

**Options envisagées :**
- **A. Aucun index, date dans le nom et dernier usage dans le `mtime`** : tout se déduit du dossier, aucune désynchronisation possible, un parcours du dossier à l'ouverture et à l'éviction.
- **B. Index SQLite** : requêtes LRU simples, mais une base à tenir cohérente avec les fichiers, orphelins et base corrompue compris.
- **C. Index JSON en mémoire, réécrit à chaque écriture** : un arrêt brutal perd l'index et laisse des orphelins à rescanner.

**Choix : A**

**Rationale :**
- Décision du propriétaire le 2026-09-19.
- ADR-013 refuse toute optimisation qui rendrait la suppression du dossier dangereuse : sans index, il n'existe aucun état à désynchroniser.
- Un run type compte 100 morceaux : le parcours d'un dossier de quelques milliers de fichiers reste négligeable devant la latence de l'API.
