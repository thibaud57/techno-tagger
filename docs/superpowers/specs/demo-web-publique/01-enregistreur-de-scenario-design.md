---
feature: "Post-MVP Feature 1 : Démo web publique"
subproject: "enregistreur-de-scenario"
goal: "Acter l'architecture de la démo dans ADR-023 et produire son scénario en faisant jouer au vrai sidecar chaque branche du parcours, sur un catalogue fictif face à un faux techno-scraper"
status: "draft"
complexity: "L"
tdd_scope: "partial"
depends_on: []
date: "2026-10-25"
---

# Enregistreur du scénario de démo

## Scope

ADR-023 acte l'architecture de la démo web publique : rejeu d'un run enregistré, données fictives, isolation et déploiement. Un enregistreur fait jouer au vrai sidecar, en process, chaque branche du parcours sur un catalogue fictif face à un faux techno-scraper. Il écrit le scénario et les pochettes générées, et une garde stricte en CI casse dès qu'une réponse du sidecar diverge du scénario versionné. Exclut toute ligne TypeScript (lots 2 et 3), PRODUCTION.md (lot 4) et le script `sidecar/demo.py`, qui garde son rôle de bibliothèque locale pour piloter l'app à la main.

### État livré

À la fin de ce sub-project, on peut : lancer `just record-demo` et obtenir un `src/demo/` identique au contenu versionné. Le test de garde passe en CI et casse, en nommant la réponse en cause, dès qu'un changement du sidecar modifie une réponse enregistrée.

## Dependencies

Aucune : ce sub-project est autoporté.

Ce lot fixe le format du scénario, consommé par `02-shell-de-demo-design.md` (chemins que renvoient les sélecteurs de fichiers) et par `03-rejeu-du-scenario-design.md` (réponses rejouées).

## Files touched

- **À créer** : `docs/adrs/023-demo-web-par-rejeu.md` (via `Skill[architecture-doc]`)
- **À créer** : `sidecar/tests/helpers/demo_catalogue.py` (catalogue fictif, seule source des morceaux, labels, réponses du faux techno-scraper et URLs de rattrapage)
- **À créer** : `sidecar/tests/helpers/demo_covers.py` (génération SVG des pochettes, style B)
- **À créer** : `sidecar/tests/helpers/demo_scenario.py` (modèle pydantic du scénario, normalisation, assemblage, valeurs figées)
- **À créer** : `sidecar/tests/helpers/demo_recording.py` (pilotage des sessions, écriture de `src/demo/`)
- **À modifier** : `sidecar/tests/helpers/audio_samples.py` (verrou exclusif pour l'échec d'extraction, `held_open` laissant la copie lire le fichier)
- **À modifier** : `sidecar/tests/helpers/vlc_dump.py` (playlists choisies par l'appelant, défaut inchangé)
- **À créer** : `sidecar/record_demo.py` (CLI mince à côté de `demo.py`, appelle `demo_recording`)
- **À créer** : `sidecar/tests/integration/test_demo_scenario.py` (garde stricte, validité protocole, absence de données de la machine, cohérence catalogue et pochettes)
- **À créer** : `sidecar/tests/unit/test_demo_normalization.py` (normalisation, clé de commande, assemblage, valeurs figées)
- **À créer** : `sidecar/tests/unit/test_demo_covers.py` (pochettes)
- **À créer** : `src/demo/scenario.json` (généré)
- **À créer** : `src/demo/artworks/<référence>.svg` (générés, un par sortie du catalogue)
- **Référence** : `docs/superpowers/specs/demo-web-publique/01-pochettes-options.html` (page d'options validée le 2026-10-25 : catalogue et algorithme des pochettes, option B retenue), déjà en place
- **À modifier** : `docs/ARCHITECTURE.md` (table des ADRs, entrée des Évolutions Futures, arborescence : `src/demo/`, helpers `demo_*`, `record_demo.py`)
- **À modifier** : `docs/BRAINSTORM.md` (Feature 1 du Post-MVP : la note « à acter par un ADR » devient un renvoi à ADR-023)
- **À modifier** : `Justfile` (recette `record-demo`, groupe `dev`, dossier `sidecar`, sur le modèle de `demo`, via `Skill[justfile-creator]`)
- **À modifier** : `.prettierignore` (`src/demo/` : JSON écrit par Python, hors du format de Prettier que `just lint-ui` vérifie sur tout le dépôt)
- **À modifier** : `.claude/skills/quality-check/SKILL.md` (piège de la garde stricte et son remède `just record-demo`, via `Skill[skill-creator]`)
- **À modifier** : `.claude/CLAUDE.md` (Must-do No-lib-test : la garde stricte rejoint `data_collection` dans les exceptions voulues, via `Skill[claude-md-doc]`)
- **À modifier** : `sidecar/pyproject.toml` (`per-file-ignores` de `record_demo.py` si le CLI en a besoin, sur le modèle de `demo.py`)

## Architecture approach

- **ADR-023**, écrit en tête du lot via `Skill[architecture-doc]`. Il porte les options comparées pendant l'étude du 2026-10-25 (rejeu, sidecar sur le serveur, Pyodide, `mockIPC`), les données fictives (CGU Beatport), l'isolation Dokploy, le build en CI au tag et la garde stricte. Les décisions datées sont déjà dans `docs/BRAINSTORM.md` § Notes. S'appuie sur ADR-005 (contrat NDJSON), ADR-014 (rien de personnel ne part) et ADR-021 (dépôt public).
- **Le vrai sidecar, en process.** Chaque session lance `run_loop` par `ndjson_loop.conversation()` et pilote le dialogue par `expect()`. L'environnement des tests d'intégration est reproduit hors pytest, d'après `tests/conftest.py` (keyring, `LOCALAPPDATA`) et `tests/integration/conftest.py` (`tagging_transports`), fakes pris dans `tests/helpers/` (`.claude/rules/pytest/tests.md`) :
  - `LOCALAPPDATA` neuf par session ;
  - `keyring.set_keyring(MemoryKeyring())` avec une clé posée, pour que `version.api_key_configured` soit vrai ;
  - `handlers.tagging_transports` remplacé par des `MockTransport` sur `FakeApi.gated_handler` et `FakeCdn.handler`, avec `public_resolver` ;
  - `scraper_client._BANDCAMP_HOST` remplacé par un motif qui accepte `*.bandcamp.example`, pour que le rattrapage par URL n'écrive aucun domaine réel dans le dépôt.
  Aucun appel réseau, aucune clé réelle (`.claude/rules/httpx2/client.md`, `.claude/rules/keyring/secrets.md`).
- **Aucune modification du code de production.** Tout ce qui manque à l'enregistreur s'ajoute aux helpers de test : une gate sur `FakeCdn`, par exemple, si l'ordre des pochettes l'exige. Les remplacements d'attributs de module (`tagging_transports`, `_BANDCAMP_HOST`, sources figées) vivent dans le harnais et sont rétablis à la sortie de chaque session.
- **Un catalogue, une source** (`demo_catalogue.py`). Les 13 morceaux et 4 labels de `01-pochettes-options.html` (tableau « Catalogue fictif ») : 11 sorties résolues, un morceau absent de la bibliothèque, un échec d'extraction. BPM, tonalité, genre, date de sortie et ISRC sont fictifs, au choix du builder, cohérents d'une sortie à l'autre d'un même label. Le catalogue alimente :
  - la bibliothèque (`audio_samples.tagged_audio`, les quatre formats) ;
  - le dump VLC (`vlc_dump.build_dump`, une seule playlist, « Set du samedi ») ;
  - les réponses du faux techno-scraper (`scraper_responses.track_payload` et `bandcamp_track_payload`, champs fictifs) ;
  - les URLs de rattrapage pré-remplies ;
  - les pochettes.
  Les payloads respectent le contrat de techno-scraper (`.claude/rules/techno-scraper/contrat.md`).
- **Parcours enregistré**, au plus deux arbitrages sur la route du visiteur :
  - **démarrage** : les deux commandes que l'interface envoie au lancement (`get_version`, `get_interrupted_run`, qui répond « aucun run interrompu ») et les trois requêtes de la page Réglages (`list_runs`, `get_rollback_target`, `get_cache_size`), enregistrées en tête de chaque session de combinaison, avant le tagging ;
  - **extraction** en copie et en déplacement, puis une seconde extraction (tout déjà présent) ;
  - **tagging** du dossier extrait ;
  - **arbitrages** sur « Sub Rosa » (deux candidats Beatport, rien sur Bandcamp) et « Тишина » (un candidat Beatport faux, le bon sur Bandcamp), retour à Beatport compris ;
  - **rattrapage par URL** de « Lowlands » seul, lien pré-rempli (décision du propriétaire, 2026-10-25). Un morceau refusé à l'arbitrage se passe, son champ d'URL est indisponible en démo (lots 2 et 3) ;
  - **écriture** avec « Glass Corridor » verrouillé par `audio_samples.held_open` pendant `commit_run`, relâché avant `retry_write` ;
  - **après l'écriture** : `list_runs`, `load_run`, `get_rollback_target`, `rollback` du run entier ;
  - **un run passé** enregistré avant la session principale, pour qu'il figure dans l'historique dès le démarrage. Trois sorties du catalogue (Nadia Kessler, Oblique Unit, Kaltwerk) dans un dossier « Set de la semaine dernière », daté de deux mois avant la date fixe de la démo. Son dump de restauration est retiré, comme le ferait la purge des 30 jours (mon choix, 2026-10-25). Au démarrage, `get_rollback_target` ne renvoie donc aucune cible, et seul le run du visiteur devient restaurable. Son rapport reste consultable. La garde vérifie ces trois réponses initiales.
- **Réponses indexées par ce dont elles dépendent.** Le protocole n'a pas d'id de requête : le scénario associe chaque commande à ses lignes de réponse.
  - Une décision d'arbitrage dépend du seul morceau et du choix : `arbitration.py` n'émet que l'état du morceau. Le visiteur tranche dans l'ordre qu'il veut.
  - Le rattrapage de « Lowlands » émet aussi le compteur « rattrapés sur à rattraper » du run (`url_recovery.py`), qui dépend des issues des deux autres morceaux à décision.
  - L'écriture, la relance, l'historique, le récap et la restauration dépendent de l'ensemble des issues. L'enregistreur énumère toutes les combinaisons d'issues des trois morceaux à décision, soit 32 combinaisons (4 × 4 × 2) :

    | Morceau | Issues |
    |---|---|
    | « Sub Rosa » | candidat Beatport 1, candidat Beatport 2, refusé, laissé en attente |
    | « Тишина » | candidat Beatport, candidat Bandcamp, refusé, laissé en attente |
    | « Lowlands » | rattrapé par URL, laissé sans correspondance |

    « Refusé » et « laissé en attente » sont enregistrés tels que le sidecar les traite à `commit_run`, sans rien présumer.
  - Deux sessions par combinaison, soit 64 : après l'écriture en échec, l'une relance puis restaure, l'autre restaure sans relancer. Chaque session repart d'une copie neuve du dossier extrait. L'extraction s'enregistre une fois, hors combinaisons. Dans chaque session, le rattrapage de « Lowlands » vient après les décisions des deux autres morceaux, ce qui couvre toutes les situations où le visiteur peut le faire.
  - Les trois requêtes de la page Réglages (`list_runs`, `get_rollback_target`, `get_cache_size`) sont rejouées dans chaque session après `run_finished`, après chaque décision et après le rattrapage : les sessions parcourant toutes les combinaisons dans le même ordre, chaque état intermédiaire que le visiteur peut atteindre (ouvrir les Réglages au milieu des arbitrages, par exemple) a sa réponse.
  - **Clé de commande** : le nom de la commande et ses champs identifiants, aux clés triées, un champ absent valant `null`. La liste des champs identifiants par commande est une constante de `demo_scenario.py`, écrite dans la table `key_fields` du scénario : une source, deux lecteurs, l'enregistreur qui compte ses rangs et le lot 3 qui rejoue. `start_tagging` est identifié par son dossier, pas par ses seuils ; `extract_playlist` par son mode et sa playlist. Une garde ferme la table sur les commandes du protocole (`ts_discriminant_owners("command")` de `protocol_mirror.py`). Le lot 3 ne tient aucune copie.
  - Deux sortes de réponses (mon choix, 2026-10-25) :
    - **sans état**, indexées par la clé de commande et un rang d'appel compté par session : `get_version`, `get_interrupted_run`, `list_playlists`, extraction, lancement du tagging, arbitrages, `load_run` du run passé. Une réponse à une décision porte l'issue qu'elle donne au morceau, et une réponse qui fait changer de phase porte la phase atteinte, pour que le lot 3 tienne issues et phase sans rien déduire ;
    - **avec état**, indexées par la clé de commande et la signature de l'état : l'issue courante de chaque morceau à décision, plus la phase (`idle` avant le tagging, puis avant écriture, écriture en échec, écrit, restauré après relance, restauré sans relance). C'est le cas des trois requêtes de la page Réglages, du rattrapage de « Lowlands » et de tout ce qui suit `commit_run`. `start_tagging` fait passer d'`idle` à « avant écriture ».
    La seconde extraction est indexée par son rang d'appel.
  - Le lot 3 n'a qu'à chercher une réponse, sans rien recalculer : aucun compteur, aucun agrégat en TypeScript.
- **Format du scénario.** Un modèle pydantic gelé (`.claude/rules/pydantic/modeles.md`), sérialisé en JSON déterministe (clés triées, indentation fixe). Il contient :
  - une version de schéma ;
  - les chemins de démo que renvoient les sélecteurs de fichiers ;
  - la table `key_fields` ;
  - les issues de départ des trois morceaux à décision (`initial_outcomes`), la phase de départ étant toujours `idle` ;
  - la table dédupliquée des lignes ;
  - les réponses sans état (commande, rang `call`, issues posées `sets`, phase atteinte `enters`, index de lignes) et les réponses avec état (commande, `outcomes`, `phase`, `sets`, `enters`, index de lignes).
  Le détail des types se fixe dans le plan. Le lot 2 en tient un miroir TypeScript, gardé comme `test_protocol_mirror.py` garde `protocol.ts`.
- **Valeurs figées à la source.** Le harnais remplace, le temps d'une session, les attributs de module qui tirent le hasard et lisent l'horloge, comme les tests remplacent `tagging_transports` : `secrets` de `tagger.run.tagging` (`run_id`) et `datetime` de `tagger.handlers` et `tagger.run.writing`. Toutes les sessions tournent sous ces valeurs, extraction et démarrage compris : le rapport d'extraction est daté par `handlers` à la seconde. `run_id` et dates sortent donc fixes, noms de rapport compris, sans réécriture après coup. L'assemblage refuse deux réponses différentes pour une même clé : une source de variation oubliée casse l'enregistrement en la nommant, au lieu de faire clignoter la garde.
- **Normalisation** (fonction pure, `.claude/rules/python/fichiers-io.md`) :
  - la version du sidecar (`version.version`) devient une valeur fixe. Sinon chaque bump de release-please casserait la garde sur une PR que personne ne réenregistre. Le lot 2 la remplace par `APP_VERSION` ;
  - la racine temporaire devient `C:\Users\Demo\…` ;
  - le chemin de cache d'une pochette devient son fichier `artworks/<référence>.svg`.
  Toute autre valeur qui varie d'un enregistrement à l'autre et que l'implémentation découvre (taille du cache, par exemple) rejoint cette liste, dans le même module. Le modèle de chaque événement doit encore valider la ligne normalisée. Fichiers écrits en UTF-8 et en LF, ce que `.gitattributes` (`* text=auto eol=lf`) garantit déjà.
- **Ordre déterministe.** La phase réseau résout les morceaux en parallèle (`TaskGroup`, sémaphores par source) : l'ordre des `track_resolved` et des `progress` peut varier. L'enregistreur sérialise la résolution par `FakeApi.gate()`, une gate par recherche (source et requête). Il relâche un morceau à la fois, dans l'ordre du catalogue, source après source, et attend son événement avant le suivant (`.claude/rules/python/asyncio.md`). La sortie du sidecar n'est jamais réordonnée après coup.
- **Pochettes, style B** (`demo_covers.py`) : un motif par label (anneaux, ondes, trames, points), une variation et une teinte par sortie tirées d'un hash de la référence, la référence en petit.
  - L'algorithme est celui de la page d'options validée le 2026-10-25 : même hash FNV-1a, même générateur mulberry32, mêmes motifs. Il est porté en Python sans dépendance.
  - Un SVG par sortie dans `src/demo/artworks/`.
- **Emplacement `src/demo/`**, hors de `public/` : `angular.json` ne copie que `public/`, qui part dans l'installeur desktop. Le lot 2 branche `src/demo/` dans les seuls assets de la configuration `demo`. Le dossier est entièrement généré : `just record-demo` le réécrit en entier, pochettes orphelines comprises. Il est exclu de Prettier (`.prettierignore`) : `just lint-ui` vérifie le format de tout le dépôt, et le JSON de Python (tableaux développés) n'est pas celui de Prettier.
- **Garde stricte** (`test_demo_scenario.py`) : réenregistre dans `tmp_path`, puis compare scénario et pochettes au contenu versionné de `src/demo/`.
  - Un écart fait échouer le test sur la commande dont la réponse a changé, avec la consigne `just record-demo`.
  - Le test lit un fichier hors de `sidecar/`, comme `test_protocol_mirror.py` lit `protocol.ts`.
  - Il tourne sur le runner `windows-2025` du job sidecar, où `held_open` fonctionne. Aucun autre OS n'est visé.
  - Les 64 sessions allongent la suite du sidecar : la durée mesurée au premier enregistrement est consignée dans le plan.
  - **Exception voulue à la règle No-lib-test** : une montée de rapidfuzz, mutagen ou pydantic qui change un score ou une sérialisation rougit la garde sans régression de notre code. C'est le prix de la décision « stricte » ci-dessous, et le même type d'exception que `data_collection` (ADR-014). ADR-023 et le Must-do du CLAUDE.md la consignent avec sa procédure : sur une PR Dependabot du sidecar rouge sur cette garde, réenregistrer sous Windows, relire le diff de `src/demo/` et le commiter dans la même PR.
- **Typage et lint** : mypy strict sans `Any` (`.claude/rules/mypy/strict.md`, `.claude/rules/python/type-hints.md`), Ruff (`.claude/rules/ruff/lint-format.md`). Helpers importés comme ceux de `demo.py` (`.claude/rules/python/imports-modules.md`), commande lancée par `uv run` (`.claude/rules/uv/projet.md`). Tags et dump suivent `.claude/rules/mutagen/tags.md` et `.claude/rules/vlc-media-db/playlists.md`.

## Acceptance criteria

### Scénario 1 : régénération à l'identique
**GIVEN** un `src/demo/` versionné et un sidecar inchangé
**WHEN** `just record-demo` tourne
**THEN** `git status` ne montre aucun changement dans `src/demo/`

### Scénario 2 : la garde casse sur un changement de comportement
**GIVEN** un changement du sidecar qui modifie une réponse enregistrée (par exemple un seuil par défaut qui fait passer un morceau de « validé seul » à « arbitrage »)
**WHEN** la CI lance la suite du sidecar
**THEN** `test_demo_scenario.py` échoue en nommant la commande dont la réponse diffère
**AND** le message indique de lancer `just record-demo` puis de commiter

### Scénario 3 : chaque ligne respecte le protocole courant
**GIVEN** le scénario versionné
**WHEN** la garde le relit
**THEN** chaque commande se parse par `parse_command`
**AND** chaque ligne de réponse se valide contre la classe d'événement que désigne son champ `event`

### Scénario 4 : rien de la machine dans le scénario
**GIVEN** un enregistrement lancé sous un profil Windows quelconque
**WHEN** la garde parcourt le scénario
**THEN** aucune ligne ne contient le nom d'utilisateur de l'OS ni la racine temporaire, et tout chemin Windows commence par le préfixe de démo
**AND** tout horodatage est l'un des deux instants figés, tout `run_id` l'un des deux identifiants figés
**AND** toute URL est sur un domaine réservé (`.example`)

### Scénario 5 : toutes les combinaisons ont une réponse
**GIVEN** les issues possibles des trois morceaux à décision
**WHEN** la garde énumère leurs combinaisons
**THEN** chacune a ses réponses à `commit_run`, `retry_write`, `list_runs`, `load_run`, `get_rollback_target` et `rollback`, dans chaque phase où le visiteur peut les déclencher
**AND** le rattrapage de « Lowlands » a sa réponse pour chaque combinaison d'issues des deux autres morceaux
**AND** `list_runs`, `get_rollback_target` et `get_cache_size` ont leur réponse dans chaque état intermédiaire des arbitrages

### Scénario 6 : l'état initial est enregistré
**GIVEN** le scénario versionné
**WHEN** la garde cherche les réponses sans état de rang 1 à `get_version` et `get_interrupted_run`, et les réponses avec état en phase `idle` aux trois requêtes de la page Réglages
**THEN** elles existent, `get_interrupted_run` ne signale aucun run, `list_runs` ne liste que le run passé et `get_rollback_target` ne renvoie aucune cible

### Scénario 7 : une pochette par sortie
**GIVEN** le catalogue
**WHEN** la garde compare le catalogue à `src/demo/artworks/`
**THEN** chaque sortie résolue a son SVG et chaque SVG désigne une sortie du catalogue
**AND** chaque pochette référencée par une ligne du scénario existe

### Scénario 8 : l'architecture est actée
**GIVEN** le lot terminé
**WHEN** on lit `docs/adrs/023-demo-web-par-rejeu.md`
**THEN** l'ADR est au statut `accepted`, référencé par la table des ADRs d'ARCHITECTURE.md et par la Feature 1 du Post-MVP du BRAINSTORM

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_demo_normalization.py` :
  - replaces the sidecar version with the fixed demo version
  - rewrites paths under the recording root to the demo prefix and leaves other strings untouched
  - maps an artwork cache path to its cover file
  - keys a command on its identifying fields only
  - lists every protocol command in the key fields table
  - restarts call ranks in each session
  - refuses two different replies for the same key
  - freezes the run id and the clock inside a session only
- `sidecar/tests/unit/test_demo_covers.py` :
  - renders the same cover twice for the same release
  - names one cover per resolved release after its reference
  - draws every release of a label with that label's motif

### Integration
- `sidecar/tests/integration/test_demo_scenario.py` :
  - re-recording yields the committed scenario and covers
  - every recorded command parses and every response line validates against its event model
  - no line leaks the recording root or the OS user name and every path starts with the demo prefix
  - every timestamp and run id is one of the frozen values
  - every URL is on a reserved domain
  - starts with the past run listed and nothing to restore
  - every combination of outcomes has its post-commit responses
  - every intermediate arbitration state answers the settings queries
  - every resolved release has a cover and every cover belongs to a release
  - every catalogue track ends as its case announces (cas d'extraction et de tagging)
  - the scenario never carries the sidecar version
  - refuses to record outside Windows

## Edge cases

- **Arbitrages tranchés dans le désordre** : réponses par morceau, indépendantes de l'ordre. Rien de plus à enregistrer.
- **Seconde extraction** : enregistrée (tout déjà présent). Le lot 3 la rejoue à partir de la deuxième demande.
- **Interruption du run (`cancel_run`)** : hors scénario. Le lot 3 décide de son comportement en démo.
- **Restauration d'un seul morceau** (`rollback` avec `track_id`) : hors scénario (mon choix, 2026-10-25). Elle multiplierait les combinaisons. Le lot 2 l'ajoute aux actions indisponibles en démo, seule « Restaurer le run » reste active. Le `rollback` du run entier est enregistré avec `track_id: null`, valeur qu'un champ absent prend aussi dans la clé.
- **Saisie hors scénario** (URL tapée à la main, seuils, URL d'un morceau refusé) : grisée en amont avec la raison « indisponible en démo » (lots 2 et 3), jamais de réponse.
- **Nouveau tagging après l'écriture** : hors scénario, le lot 3 décide de son comportement en démo.
- **Vider le cache** (`clear_cache`) : hors scénario (mon choix, 2026-10-25). Le vider changerait la taille de toutes les phases suivantes. Le lot 2 l'ajoute aux actions indisponibles en démo, `get_cache_size` reste enregistré dans chaque phase.
- **Aucun domaine réel** : le rattrapage n'accepte que les hôtes Beatport, `*.bandcamp.com` et SoundCloud (`scraper_client.py`). Un sous-domaine fictif de `bandcamp.com` serait pourtant un domaine réel, enregistrable par un tiers (sondé le 2026-10-25 : il redirige vers l'inscription). Le harnais remplace donc `_BANDCAMP_HOST` pour accepter `*.bandcamp.example`, et toutes les URLs du scénario sont sur `.example` (garde : « every URL is on a reserved domain »). Les noms d'artistes et de labels passent par une recherche Beatport et Discogs : aucun ne doit désigner un vrai artiste ou label, le résultat et sa date sont consignés en tête de `demo_catalogue.py`.
- **Enregistrement hors Windows** : `held_open` n'existe que sous Windows. L'enregistreur échoue d'emblée avec un message clair plutôt que d'enregistrer un scénario sans le cas verrouillé.
- **Champ typé URL** : si un événement valide une URL de pochette ou de fiche, la normalisation garde une URL valide. Le scénario 3 le prouve.

## Architectural decisions

### Décision : où vit la logique d'enregistrement

**Options envisagées :**
- **A. Tout dans `sidecar/record_demo.py`** : un seul fichier. Mais hors de `pythonpath` en `--import-mode=importlib`, la garde ne peut pas l'importer sans bricoler `sys.path`.
- **B. Modules dans `tests/helpers/`, CLI mince à la racine** : importables par la garde et par le CLI, dans le `mypy_path`. Deux usages, donc leur place selon la règle des helpers.

**Choix : B**

**Rationale :**
- La garde stricte rejoue exactement le code du CLI, sans copie
- Même schéma que `demo.py`, qui importe déjà `audio_samples` et `vlc_dump`

### Décision : déterminisme de l'ordre des événements

**Options envisagées :**
- **A. Réordonner les lignes après coup** : simple, mais réécrit la sortie du sidecar et casse la cohérence de `progress.processed`.
- **B. Sérialiser la phase réseau par `FakeApi.gate()`** : la sortie reste celle du sidecar, l'ordre devient celui du catalogue.

**Choix : B**

**Rationale :**
- Le scénario doit rester ce que le vrai sidecar émet, sinon la démo ment
- Les gates existent déjà dans `tagging_api.py`

### Décision : garde stricte ou souple

**Options envisagées :**
- **A. Souple** : la CI vérifie seulement que le scénario reste valide contre le protocole. Aucune friction, mais un changement de comportement laisse la démo datée sans rien signaler.
- **B. Stricte** : la CI réenregistre et compare. Une commande et un commit à chaque changement de comportement.

**Choix : B** (décision du propriétaire, 2026-10-25)

**Rationale :**
- Le scénario est une copie du comportement du sidecar : une copie se garde par un test, jamais par la vigilance
- La démo doit montrer l'app telle qu'elle est publiée
- Coût assumé : la garde rougit aussi sur une montée de dépendance qui change une réponse. L'exception à No-lib-test est écrite dans ADR-023 et le CLAUDE.md avec sa procédure

### Décision : où vit la table des champs identifiants

**Options envisagées :**
- **A. Table `KEY_FIELDS` en TypeScript**, typée contre `SidecarCommand`, et une copie Python dans l'enregistreur pour compter les rangs : deux sources à garder par un miroir.
- **B. Table dans le scénario** (`key_fields`), écrite par l'enregistreur, lue par le lot 3, fermée sur les commandes du protocole par une garde Python.

**Choix : B**

**Rationale :**
- Une valeur, une source : l'enregistreur et le rejeu comptent les rangs avec la même clé, sans copie
- La garde Python lit déjà `protocol.ts` par `protocol_mirror.py`

### Décision : emplacement du scénario et des pochettes

**Options envisagées :**
- **A. `public/demo/`** : servi sans configuration, mais copié dans l'installeur desktop.
- **B. `src/demo/`, branché dans les seuls assets de la configuration `demo`** : rien de la démo n'entre dans l'installeur.

**Choix : B**

**Rationale :**
- `angular.json` copie `public/` dans tout build, Tauri compris
- Le bundle desktop reste inchangé, comme l'exige la feature
