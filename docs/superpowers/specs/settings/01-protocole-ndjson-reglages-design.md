---
feature: "Feature 7 : Settings"
subproject: "protocole-ndjson-reglages"
goal: "Exposer à l'interface, par le protocole NDJSON, le vidage et la taille du cache disque, les seuils de matching par défaut et le fichier de logs du sidecar"
status: "implemented"
complexity: "M"
tdd_scope: "full"
depends_on: []
date: "2026-10-14"
---

# Contrat NDJSON des Réglages

## Scope

Ce sub-project fige dans le contrat NDJSON ce dont les rangées des Réglages ont besoin du sidecar : deux commandes (`get_cache_size`, `clear_cache`), deux événements (`cache_size`, `cache_cleared`), deux champs de `version` (`default_thresholds`, `log_file`) et le code d'erreur `run_not_written`. Il comprend la mesure et le vidage du cache côté métier, le garde qui protège un run pas encore écrit, le miroir TypeScript, la reconnaissance des nouveaux événements par `SidecarService` et la mise à jour du contrat dans `ARCHITECTURE.md`. Il exclut tout écran : les rangées Seuils, Cache et Logs sont les sub-projects 03 et 04.

### État livré

À la fin de ce sub-project, on peut, par l'injection NDJSON et sans interface :
1. lire dans `version` les seuils par défaut du sidecar et le chemin du fichier de logs ;
2. envoyer `get_cache_size` sur un cache peuplé, puis `clear_cache`, et recevoir les octets libérés, les dossiers `cache/responses` et `cache/artworks` vidés ;
3. voir `clear_cache` refusé en `run_not_written` tant qu'un run résolu n'est pas écrit, puis accepté après `commit_run`.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/core/paths.py` (`log_dir()`, déplacé depuis `__main__.py`)
- **À modifier** : `sidecar/src/tagger/core/logger.py` (`LOG_FILE_NAME`, employé par `setup_logging`)
- **À modifier** : `sidecar/src/tagger/resolution/cache.py` :
  - `cache_dir()` ;
  - `cache_size(root)` ;
  - `clear_cache(root)` et son retour `ClearedCache`.
- **À modifier** : `sidecar/src/tagger/protocol.py` :
  - commandes `GetCacheSize`, `ClearCache` ;
  - événements `CacheSize`, `CacheCleared` ;
  - `Version.default_thresholds`, `Version.log_file` ;
  - unions `AnyCommand`, `ExecutableCommand`, `CommandName`.
- **À modifier** : `sidecar/src/tagger/handlers.py` :
  - `handle_get_version` (défauts et fichier de logs) ;
  - `handle_get_cache_size`, `handle_clear_cache` ;
  - `CurrentRun.awaits_write` ;
  - `_cache_dir` remplacé par `cache_dir()`.
- **À modifier** : `sidecar/src/tagger/__main__.py` :
  - `RunNotWrittenError` ;
  - `_Session.clear_cache` ;
  - deux `case` dans `_dispatch` ;
  - `log_dir` importé de `core/paths.py`.
- **À modifier** : `src/app/core/sidecar/protocol.ts` (deux commandes, deux événements, champs de `VersionEvent`, unions `SidecarCommand` et `SidecarEvent`)
- **À modifier** : `src/app/core/sidecar/sidecar.service.ts` :
  - signaux `defaultThresholds`, `logFile`, `cacheSize`, `cacheCleared` ;
  - méthodes `loadCacheSize()` (lecture, comme `loadRollbackTarget()`), `clearCache()` ;
  - `KNOWN_EVENTS` et `handleLine`.
- **À modifier** : `src/app/core/sidecar/sidecar.service.spec.ts` (littéraux `version` passés par un helper, envoi des commandes, routage des événements)
- **À modifier** : `src/fixtures/sidecar-stub.ts` (nouveaux membres publics du service dans `defaults()`)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.run_not_written`)
- **À modifier** : `sidecar/tests/unit/core/test_paths.py` (garde du chemin des logs, repris de `test_main.py`)
- **À modifier** : `sidecar/tests/unit/test_main.py` (garde de `log_dir` retiré)
- **À modifier** : `sidecar/tests/unit/resolution/test_cache_disk.py`
- **À modifier** : `sidecar/tests/unit/test_protocol_models.py` (littéral `Version`, nouvelles commandes dans `CommandName`)
- **À créer** : `sidecar/tests/integration/test_ndjson_settings.py`
- **À modifier** : `docs/ARCHITECTURE.md` :
  - § API : lignes de commandes et d'événements, champs de `version`, `run_not_written` ;
  - ligne `set_api_key` : retrait de « `clear_cache` absent du contrat » ;
  - § Données & cache : garde du vidage ;
  - § Matching : défauts exposés par `version`.

## Architecture approach

### Conventions du protocole

Les commandes héritent de `Command` (`extra="forbid"`, `strict=True`, ADR-022), les événements de `Event` (`frozen`). Le sidecar n'émet aucune phrase, seulement un `code` et des `params` (`.claude/rules/pydantic/modeles.md`). Chaque champ ajouté côté Python a, dans la même tâche, son miroir `protocol.ts`, ses littéraux de test et son stub (`.claude/rules/typescript/types.md`).

### `version` : défauts et fichier de logs

- `default_thresholds` est un `ThresholdsPayload` construit depuis `DEFAULT_THRESHOLDS` (`resolution/matching.py`) : une valeur, une source, l'interface n'écrit jamais 70 ni 90. Le même modèle sert déjà à `start_tagging`, la forme est identique dans les deux sens.
- `log_file` est `log_dir() / LOG_FILE_NAME`, constante de `core/logger.py` que `setup_logging` emploie aussi : le dossier et le nom du fichier restent définis là où le logger s'arme. L'interface le révèlera dans l'Explorateur par `revealItemInDir` du plugin `opener` (sub-project 04), déjà accordé et sans scope : le fichier sélectionné est celui à joindre, là où révéler le dossier ouvrirait son parent.
- `version` est déjà émis au démarrage et en réponse à `set_api_key`, et déjà consommé par l'interface : aucun aller-retour de plus.
- `log_dir()` passe dans `core/paths.py`, à côté d'`app_data_dir()` : `handlers` en a besoin et ne peut pas importer `__main__` (`.claude/rules/python/imports-modules.md`). Son commentaire, qui explique pourquoi le chemin est recalculé et non reçu de Tauri, le suit.

### Mesure et vidage du cache

- `cache_dir()` rejoint `cache.py`, comme `plan_dir()` dans `run/plan.py` et `dump_dir()` dans `tags/tag_dump.py`. `_cache_dir(name)` de `handlers.py` devient `cache_dir() / name`.
- `cache_size(root)` somme la taille des fichiers sous `root`, récursivement. Une racine absente vaut zéro.
- `clear_cache(root)` supprime chaque fichier sous `root` et rend `ClearedCache(freed_bytes, size_bytes)` : les octets réellement supprimés, puis ce qui reste. Les dossiers restent en place (`DiskCache.begin` les recrée de toute façon). Il réutilise `_size_of` et `_unlink` : un fichier qu'un antivirus tient ouvert reste en place, est compté dans `size_bytes`, et un `warning` logfmt `reason=unlink_failed` part, sans lever (`.claude/rules/python/fichiers-io.md`, `.claude/rules/python/gestion-erreurs.md`).
- Le vidage porte sur tout `cache/` : réponses et pochettes, et tout dossier que le cache gagnerait plus tard. Plans, dumps, rapports et logs vivent hors de `cache/` et ne sont jamais touchés (ADR-013).

### Commandes et garde

- **`get_cache_size`** répond `cache_size { size_bytes }`. Patron pull de `get_rollback_target` : l'interface demande à l'ouverture des Réglages, le sidecar n'émet rien de lui-même.
- **`clear_cache`** répond `cache_cleared { freed_bytes, size_bytes }`. `size_bytes` sert à la rangée, `freed_bytes` au toast.
- Les deux handlers sont bloquants et passent par `asyncio.to_thread` dans `_dispatch`, comme `get_rollback_target` (`.claude/rules/python/asyncio.md`). Aucune phase longue n'est ouverte : la boucle attend la fin du vidage avant de lire la commande suivante, donc un `start_tagging` envoyé entre-temps part après, sans course.
- **Garde de `clear_cache`**, dans `_Session.clear_cache` :
  1. `_ensure_idle()` : refus en `phase_busy` pendant une extraction, une phase réseau, une écriture ou une restauration ;
  2. refus en `run_not_written` (`RunNotWrittenError`, sans params, déclaré à côté de `PhaseBusyError`) si le run courant attend une écriture.
- **`CurrentRun.awaits_write`** est vrai quand le run n'est pas confirmé (`writer is None`) ou qu'un de ses morceaux est en `write_error`, donc rejouable par `retry_write`. `write_tags` lit la pochette depuis `cache/artworks` au moment de l'écriture et garde l'image d'origine quand elle manque (`tags/files.py`) : sans ce garde, vider le cache entre la résolution et l'écriture ferait écrire les morceaux sans leur nouvelle pochette, en silence. Un run interrompu en pleine phase réseau reste courant et non confirmé, il est donc couvert.

### Interface

- `SidecarService` pose `defaultThresholds` et `logFile` depuis `version`. `cacheSize` est posé par `cache_size` et par `cache_cleared`. `cacheCleared` garde le dernier `cache_cleared`, que le toast du sub-project 04 lira. Tous en lecture seule (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`).
- `loadCacheSize()` passe par `query`, comme `loadRollbackTarget()` : une lecture sans moteur lancé ne signale rien. `clearCache()` passe par `send`. Les deux événements entrent dans `KNOWN_EVENTS` et `handleLine`, dont le `never` rend l'oubli visible à la compilation (`.claude/rules/typescript/types.md`).
- `errors.run_not_written` dit la cause puis le geste qui répare, une phrase par ligne, en FR et en EN : un run attend l'écriture de ses tags, les écrire avant de vider le cache (`.claude/rules/ngx-translate/i18n.md`). `test_error_translations.py` impose la clé dès que le code existe.

### Rules applicables

`.claude/rules/pydantic/modeles.md`, `.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/fichiers-io.md`, `.claude/rules/python/gestion-erreurs.md`, `.claude/rules/python/asyncio.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/imports-modules.md`, `.claude/rules/python/pattern-matching.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/ruff/lint-format.md`, `.claude/rules/tauri/sidecar.md`, `.claude/rules/typescript/types.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/tests.md`, `.claude/rules/angular/rxjs-interop.md`, `.claude/rules/ngx-translate/i18n.md`.

## Acceptance criteria

### Scénario 1 : défauts et fichier de logs au démarrage
**GIVEN** un sidecar fraîchement lancé
**WHEN** l'interface envoie `get_version`
**THEN** `version` porte `default_thresholds` égal à `DEFAULT_THRESHOLDS`
**AND** `log_file` désigne `tagger.log` dans le dossier `logs` sous la racine des données de l'application

### Scénario 2 : taille du cache
**GIVEN** un cache contenant des réponses et des pochettes
**WHEN** l'interface envoie `get_cache_size`
**THEN** `cache_size.size_bytes` vaut la somme des tailles des fichiers des deux dossiers

### Scénario 3 : vidage hors run
**GIVEN** un cache peuplé et aucun run courant
**WHEN** l'interface envoie `clear_cache`
**THEN** `cache_cleared.freed_bytes` vaut la taille d'avant le vidage
**AND** `cache_cleared.size_bytes` vaut zéro
**AND** les dossiers `cache/responses` et `cache/artworks` ne contiennent plus aucun fichier
**AND** le dossier des plans et le registre des rapports sont intacts

### Scénario 4 : refus pendant un run non écrit
**GIVEN** un run dont la phase réseau est finie et qui n'a pas reçu `commit_run`
**WHEN** l'interface envoie `clear_cache`
**THEN** le sidecar émet `error` de code `run_not_written` pour la commande `clear_cache`
**AND** les pochettes du run sont toujours dans `cache/artworks`

### Scénario 5 : refus pendant une phase longue
**GIVEN** une phase réseau en cours
**WHEN** l'interface envoie `clear_cache`
**THEN** le sidecar émet `error` de code `phase_busy` portant la phase `tagging`

### Scénario 6 : vidage après écriture
**GIVEN** un run écrit sans échec
**WHEN** l'interface envoie `clear_cache`
**THEN** le sidecar répond `cache_cleared`

### Scénario 7 : routage côté interface
**GIVEN** `SidecarService` connecté au moteur
**WHEN** arrivent `version`, `cache_size` puis `cache_cleared`
**THEN** `defaultThresholds`, `logFile`, `cacheSize` et `cacheCleared` reflètent ces événements

## Tests à écrire

### Unit
- `sidecar/tests/unit/resolution/test_cache_disk.py` :
  - `cache_size` somme les fichiers de plusieurs sous-dossiers
  - `cache_size` vaut zéro sur une racine absente
  - `clear_cache` supprime tous les fichiers, garde les dossiers et rend les octets libérés
  - `clear_cache` garde un fichier dont la suppression échoue, le compte dans `size_bytes` et ne lève pas (`unlink` patché en `PermissionError`)
  - `clear_cache` sur une racine absente rend zéro sans lever
- `sidecar/tests/unit/core/test_paths.py` :
  - `log_dir` est le dossier `logs` sous `app_data_dir()` (garde repris de `test_main.py`)
- `sidecar/tests/unit/test_protocol_models.py` :
  - `CommandName` couvre `get_cache_size` et `clear_cache` (test existant, qui échoue tant que la liste n'est pas étendue)
- `src/app/core/sidecar/sidecar.service.spec.ts` :
  - `loadCacheSize()` et `clearCache()` envoient leur commande (`it.each` existant)
  - `version` expose `defaultThresholds` et `logFile`
  - `cache_size` puis `cache_cleared` mettent à jour `cacheSize`, et `cache_cleared` pose `cacheCleared`

### Integration
- `sidecar/tests/integration/test_ndjson_settings.py` :
  - `get_version` rend les défauts et le fichier de logs, tels que l'interface les lit sur le fil
  - `get_cache_size` puis `clear_cache` sur un cache peuplé dans `app_data` : octets libérés, dossiers vides, plans intacts
  - un second `clear_cache` de suite rend zéro sans erreur
  - `clear_cache` refusé en `run_not_written` après un run résolu non confirmé, fichiers du cache conservés
  - `clear_cache` refusé en `run_not_written` après un `cancel_run` en pleine phase réseau
  - `clear_cache` refusé en `run_not_written` tant qu'un échec d'écriture attend sa relance
  - `clear_cache` refusé en `phase_busy` pendant la phase réseau
  - `clear_cache` accepté après `commit_run` sans échec, puis un nouveau run sur le même dossier va au bout de sa phase réseau

`CurrentRun.awaits_write` n'a pas de test unitaire propre : les trois refus et l'acceptation ci-dessus en couvrent chaque branche à travers la boucle.

## Edge cases

- **Cache jamais créé** : `cache_size` et `clear_cache` rendent zéro, sans erreur.
- **Fichier verrouillé** : il reste, `size_bytes` le compte, l'interface affiche ce qui reste plutôt que zéro.
- **`load_run` en vol** : `clear_cache` n'est pas refusé. Les pochettes du récapitulatif en cours de chargement peuvent manquer et reviennent au chargement suivant (cache puis CDN).
- **Run courant déjà écrit, encore affiché** : ses vignettes pointent vers des fichiers supprimés et cassent. Accepté : le cache est jetable (ADR-013), et la pochette est déjà dans les fichiers.
- **Run interrompu en attente de reprise** : il n'est plus courant après un redémarrage, le vidage est accepté et la reprise repaiera ses appels réseau.

## Architectural decisions

### Décision : canal des seuils par défaut et du fichier de logs

**Options envisagées :**
- **A. Champs de `version`** : aucun aller-retour, événement déjà émis au démarrage et consommé, mais `version` porte plus que la version.
- **B. Commande dédiée (`get_settings`)** : canal nommé pour son usage, mais une commande, un événement et un appel de plus au démarrage.
- **C. Valeurs recopiées côté interface** : rien à changer au contrat, mais deux sources pour les seuils et le nom du dossier, divergence muette.

**Choix : A**

**Rationale :**
- `version` porte déjà `api_key_configured`, une donnée que seul le sidecar connaît et que l'interface lit avant tout run : les défauts et le fichier de logs sont de la même nature.
- C viole « une valeur, une source » (CLAUDE.md), et B ajoute un échange sans rien gagner.

### Décision : garde du vidage

**Options envisagées :**
- **A. Refus en phase longue et sur un run non écrit** : protège les pochettes à écrire, au prix d'un bouton grisé tant qu'un run attend.
- **B. Refus en phase longue seulement** : plus permissif, mais un run résolu perd ses pochettes en silence.
- **C. Jamais refusé** : ADR-013 à la lettre, mêmes pertes plus des écritures de cache coupées en plein run.

**Choix : A** (décidé par le propriétaire le 2026-10-14)

**Rationale :**
- La perte de pochette est silencieuse (`write_tags` garde l'image d'origine) : l'utilisateur ne la découvrirait qu'en ouvrant ses fichiers.
- ADR-013 garantit qu'un cache supprimé ne casse rien. Le garde ne protège pas le sidecar mais ce que l'utilisateur attend de son écriture.
