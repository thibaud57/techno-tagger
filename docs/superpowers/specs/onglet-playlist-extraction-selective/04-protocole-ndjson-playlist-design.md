---
feature: "Feature 1 — Onglet Playlist, extraction sélective"
subproject: "protocole-ndjson-playlist"
goal: "Figer et exposer sur les flux standard le contrat NDJSON des commandes et événements de l'extraction par playlist"
status: "implemented"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-parsing-playlists-design.md", "02-resolution-extraction-fichiers-design.md", "03-rapport-extraction-design.md"]
date: "2026-09-08"
---

# Protocole NDJSON : socle de la boucle et commandes de l'extraction

## Scope

Couvre les modèles Pydantic des commandes `get_version`, `shutdown`, `list_playlists` et `extract_playlist`, ceux des événements `version`, `playlists_listed`, `progress`, `extraction_finished` et `error`, et la boucle de dispatch d'`__main__.py` qui valide chaque ligne de `stdin` avant exécution et émet les événements sur `stdout`. Couvre également le moteur asynchrone qui porte cette boucle, commun à toutes les phases longues du sidecar.

Exclut les commandes de tagging, d'arbitrage, d'écriture, de reprise et d'administration, qui relèvent des Features 2 à 8 et viendront se brancher sur la même boucle. Exclut la lecture du trousseau : l'événement `version` porte l'information qu'une clé est configurée, ce que le sub-project des Settings renseignera.

### État livré

À la fin de ce sub-project, on peut : sans lancer l'interface, injecter des commandes sur `stdin` du sidecar et lire ses événements sur `stdout` — un `list_playlists` rend un `playlists_listed`, un `extract_playlist` émet une suite de `progress` puis un `extraction_finished` portant le chemin du rapport, et une commande malformée rend un `error` sans qu'aucun fichier n'ait bougé.

## Dependencies

- `01-parsing-playlists-design.md` (statut: draft) — fournit `list_playlists()` et `read_playlist()`, dispatchés par `list_playlists` et `extract_playlist`.
- `02-resolution-extraction-fichiers-design.md` (statut: draft) — fournit `extract()` et son rappel de progression, source des événements `progress`.
- `03-rapport-extraction-design.md` (statut: draft) — fournit `write_extraction_report()`, dont le chemin remonte dans `extraction_finished`.

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` (remplace le stub par les modèles de commandes et d'événements)
- **À modifier** : `sidecar/src/tagger/__main__.py` (remplace la boucle stub par le moteur asynchrone et le dispatch)
- **À créer** : `sidecar/src/tagger/handlers.py` (exécution d'une commande validée, entre le protocole et le métier)
- **À créer** : `sidecar/tests/unit/test_protocol_models.py` (validation des commandes, sérialisation des événements)
- **À créer** : `sidecar/tests/integration/test_ndjson_loop.py` (bout en bout par injection sur `stdin`)
- **À modifier** : `docs/ARCHITECTURE.md` (étendre `extraction_finished` aux cinq catégories du résultat)

## Architecture approach

- **`protocol.py` reste la seule interface publique du sidecar** (cf. `.claude/rules/python/imports-modules.md`) : il déclare les modèles, jamais la logique. L'exécution d'une commande vit dans `handlers.py`, appelé depuis la boucle, ce qui garde `__main__.py` limité au moteur et au routage.
- **Modèles Pydantic fermés sur les commandes entrantes** : `model_config = ConfigDict(extra="forbid", frozen=True, strict=True)`. Un champ inconnu est une commande malformée, pas un détail à ignorer, et la coercion lax est écartée sur ce qui vient de l'interface (cf. `.claude/rules/pydantic/modeles.md` et [ADR-022](../../../adrs/022-modeles-pydantic-du-protocole.md)).
- **Discrimination par le champ `command` et le champ `event`** : chaque modèle porte un `Literal` qui l'identifie, et une union discriminée route la ligne vers le bon modèle. C'est ce qui permet de valider en une passe par `model_validate_json` sans essayer les modèles à tour de rôle.
- **Une `ValidationError` devient un événement `error`**, jamais une trace remontée à l'écran : le `code` est stable, les `params` sont tirés de `.errors()` (`loc`, `type`), et l'interface traduit. Le sidecar n'émet aucune phrase destinée à l'utilisateur.
- **Aucun effet de bord partiel sur commande malformée** : la validation précède toute exécution, donc une commande rejetée n'a rien touché.
- **Moteur asynchrone dès ce sub-project** : `asyncio.run` et un `TaskGroup`, la lecture de `stdin` déléguée par `asyncio.to_thread(sys.stdin.readline)`. La lecture asynchrone native de `stdin` est impossible sous Windows, `loop.connect_read_pipe` y échouant sur `OSError: [WinError 6]` ; la délégation en thread est la voie que la rule `.claude/rules/python/asyncio.md` prescrit déjà pour tout appel bloquant. La Feature 2 branchera son pool borné sur cette même boucle sans réécrire le point d'entrée.
- **Les appels métier bloquants passent par `to_thread`** : lecture SQLite, parcours du dossier source, copie de fichiers, écriture du rapport. Sans quoi la boucle gèlerait et aucun `progress` ne partirait pendant une extraction.
- **`progress` alimenté par le rappel du sub-project 02** : le module d'extraction ignore le protocole, la boucle lui passe une fonction qui émet l'événement. La phase est nommée, `progress` couvrant les quatre phases longues du projet.
- **Émission d'une ligne par événement, suivie d'un flush** : `model_dump_json()` produit une seule ligne, ce qu'exige NDJSON, et n'accepte jamais d'`indent`. Le `line_buffering` déjà posé sur `stdout` par `_force_utf8_streams()` dispense d'un flush explicite (cf. [ADR-005](../../../adrs/005-sidecar-python-protocole-ndjson.md)).
- **`stdout` ne porte que des événements** : tout diagnostic va sur `stderr` et dans le fichier de log tournant, sous peine de corrompre le protocole.
- **`shutdown` sort proprement** : la boucle s'arrête, l'EOF sur `stdin` restant le filet si l'application est tuée.
- **`playlists_listed` annonce le format du fichier** (`vlc_dump` ou `m3u8`) : l'interface doit savoir s'il faut proposer un sélecteur de playlist, et reconnaître un format côté TypeScript serait une règle métier au mauvais endroit. Sur un M3U8, l'événement porte une liste vide et son format, sans erreur : détourner le canal d'erreur en canal d'information rendrait un fichier illisible indistinguable d'un M3U8 valide.
- **`extraction_finished` étendu aux cinq catégories** du résultat produit par le sub-project 02. ARCHITECTURE.md n'en décrit que trois, écrites avant que le découpage n'établisse qu'un transfert pouvait échouer sans que le morceau soit introuvable. La documentation est corrigée dans le même mouvement, sans quoi le contrat et sa description divergeraient dès la première version.

## Acceptance criteria

### Scénario 1 : Version demandée au démarrage
**GIVEN** un sidecar lancé
**WHEN** une commande `get_version` est injectée sur `stdin`
**THEN** un événement `version` est émis sur `stdout`
**AND** il porte la version du sidecar et l'indication qu'une clé d'API est configurée ou non

### Scénario 2 : Listage des playlists d'un dump
**GIVEN** un dump VLC valide
**WHEN** une commande `list_playlists` portant son chemin est injectée
**THEN** un événement `playlists_listed` est émis
**AND** il porte pour chaque playlist son identifiant, son nom et son nombre de morceaux
**AND** il annonce le format reconnu du fichier

### Scénario 3 : Extraction complète
**GIVEN** un dump VLC, un dossier source peuplé et un dossier destination
**WHEN** une commande `extract_playlist` est injectée
**THEN** des événements `progress` sont émis pendant le traitement, portant la phase et le nombre traité sur le total
**AND** un événement `extraction_finished` clôt le traitement
**AND** il porte les cinq catégories du résultat et le chemin du rapport d'extraction

### Scénario 4 : Commande malformée
**GIVEN** une ligne JSON portant un champ non déclaré
**WHEN** elle est injectée sur `stdin`
**THEN** un événement `error` est émis, portant un `code` stable et des `params` structurés
**AND** aucun fichier n'a été copié ni écrit
**AND** la boucle continue d'accepter les commandes suivantes

### Scénario 5 : Ligne illisible
**GIVEN** une ligne qui n'est pas du JSON valide
**WHEN** elle est injectée sur `stdin`
**THEN** un événement `error` est émis
**AND** le sidecar ne sort pas

### Scénario 6 : Commande inconnue
**GIVEN** une ligne JSON dont le champ de commande ne correspond à aucune commande connue
**WHEN** elle est injectée
**THEN** un événement `error` est émis, nommant la commande refusée dans ses `params`

### Scénario 7 : Erreur métier convertie en événement
**GIVEN** un chemin de dump qui n'est pas une base SQLite valide
**WHEN** une commande `list_playlists` le désignant est injectée
**THEN** un événement `error` est émis, portant le `code` de l'erreur métier et ses `params`
**AND** aucune trace technique n'apparaît sur `stdout`

### Scénario 8 : Progression émise pendant un traitement bloquant
**GIVEN** une extraction portant plusieurs morceaux
**WHEN** elle est en cours
**THEN** les événements `progress` sont émis au fil de l'eau, avant l'événement de fin
**AND** la boucle reste capable de lire `stdin`

### Scénario 9 : Arrêt demandé
**GIVEN** un sidecar en attente de commande
**WHEN** une commande `shutdown` est injectée
**THEN** le processus se termine sans erreur

### Scénario 10 : Fin de flux
**GIVEN** un sidecar en attente de commande
**WHEN** `stdin` est fermé
**THEN** le processus se termine sans erreur

### Scénario 11 : Un événement par ligne
**GIVEN** une session produisant plusieurs événements
**WHEN** la sortie est lue
**THEN** chaque ligne se parse indépendamment comme un objet JSON
**AND** aucune ligne ne porte d'indentation

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_protocol_models.py` :
  - une commande portant un champ non déclaré est rejetée
  - une commande à laquelle il manque un champ requis est rejetée
  - un champ de mauvais type n'est pas coercé silencieusement
  - le champ discriminant route la ligne vers le bon modèle de commande
  - une commande inconnue est rejetée sans lever d'exception non gérée
  - un événement se sérialise sur une seule ligne, sans indentation
  - une valeur d'énumération se sérialise en sa chaîne, pas en nom de membre
  - un `Path` d'événement se sérialise en chaîne
  - une `ValidationError` se convertit en `code` et `params` exploitables

### Integration

- `sidecar/tests/integration/test_ndjson_loop.py` :
  - `get_version` rend un `version` portant la version et l'état de la clé
  - `list_playlists` sur un dump valide rend un `playlists_listed` avec les comptes et le format `vlc_dump`
  - `list_playlists` sur un M3U8 rend un `playlists_listed` vide portant le format `m3u8`
  - `extract_playlist` rend des `progress` puis un `extraction_finished`
  - `extraction_finished` porte les cinq catégories et le chemin du rapport
  - le rapport annoncé existe réellement sur le disque
  - une commande malformée rend un `error` et n'interrompt pas la boucle
  - une ligne non-JSON rend un `error` et n'interrompt pas la boucle
  - une erreur métier rend un `error` portant son `code`
  - `shutdown` termine le processus sans erreur
  - la fermeture de `stdin` termine le processus sans erreur
  - chaque ligne émise se parse indépendamment

## Edge cases

- **Commande reçue pendant une extraction** : la boucle la lit mais la traite après, l'extraction occupant le dispatch. Aucune commande n'est perdue, seule sa prise en compte est différée. Aucun scénario du MVP n'exige d'annuler un run en cours.
- **Ligne vide sur `stdin`** : ignorée sans produire d'événement. Un flux ligne à ligne en produit à la moindre frappe et une erreur pour chacune serait du bruit.
- **Ligne très longue** : le protocole ne transporte ni pochette ni contenu de fichier, seulement des noms et des chemins. Aucun plafond n'est posé.
- **Extraction sur une playlist vide** : `extraction_finished` est tout de même émis, avec ses cinq catégories vides et le chemin d'un rapport qui existe.
- **Écriture du rapport en échec** : le run a bien extrait les fichiers, seul le rapport manque. L'événement `error` sort, distinct de `extraction_finished` qui n'est alors pas émis, faute de pouvoir en porter le chemin.

## Architectural decisions

### Décision : Moteur asynchrone dès ce sub-project plutôt qu'une boucle synchrone migrée plus tard

**Options envisagées :**
- **A. `asyncio.run` et `TaskGroup` dès maintenant**, `stdin` lu par `asyncio.to_thread(sys.stdin.readline)` et appels métier bloquants délégués de même. La Feature 2 branche son pool borné sur la même boucle sans toucher au point d'entrée.
- **B. Boucle synchrone `for line in sys.stdin`**, réécrite en asyncio quand la Feature 2 en aura besoin. Plus court à lire aujourd'hui, au prix d'une réécriture du point d'entrée et de ses tests d'intégration.

**Choix : A**

**Rationale :**
- Le besoin asynchrone est déjà acté par le projet : ARCHITECTURE.md fixe un pool borné à 3 requêtes Beatport et 2 Bandcamp ([ADR-017](../../../adrs/017-taille-pool-concurrence.md)), et la rule asyncio prescrit `to_thread` pour tout appel bloquant
- Le surcoût est faible et connu : la lecture asynchrone native de `stdin` est impossible sous Windows, `connect_read_pipe` y échouant sur `OSError: [WinError 6]`, mais `to_thread` la remplace en quelques lignes
- Le bénéfice est immédiat : les événements `progress` partent pendant qu'une commande bloquante est traitée, ce qu'une boucle synchrone ne permettrait qu'au prix d'un entrelacement écrit à la main
- L'option B ferait réécrire un point d'entrée déjà couvert par des tests d'intégration, au moment précis où la Feature 2 apporte sa propre complexité

### Décision : L'exécution des commandes vit dans un module distinct de la boucle

**Options envisagées :**
- **A. `handlers.py` entre `protocol.py` et le métier** : `__main__.py` se limite au moteur et au routage, `protocol.py` aux modèles. Chaque commande a une fonction dédiée, testable sans lancer la boucle.
- **B. Tout dans `__main__.py`** : moins de fichiers, mais le point d'entrée grossit à chaque commande ajoutée, et les Features 2 à 8 en ajoutent une quinzaine.

**Choix : A**

**Rationale :**
- Le contrat compte quatre commandes ici et une quinzaine à terme : le point d'entrée deviendrait le plus gros fichier du sidecar sans porter de logique propre
- `.claude/rules/python/imports-modules.md` réserve à `protocol.py` le rôle d'interface publique, ce qui exclut d'y mettre l'exécution
- Une fonction par commande se teste en l'appelant, sans injecter sur `stdin` ni lire `stdout`

### Décision : Étendre `extraction_finished` aux cinq catégories et corriger la documentation

**Options envisagées :**
- **A. Cinq catégories dans l'événement, ARCHITECTURE.md corrigé** : l'interface peut afficher un fichier déjà présent et une copie en échec, et la documentation décrit le contrat réel.
- **B. Trois catégories, conformes à la lettre d'ARCHITECTURE.md** : rien à corriger, mais deux cas d'échec deviennent invisibles à l'écran alors que le rapport les consigne.

**Choix : A**

**Rationale :**
- Le rapport du sub-project 03 écrit les cinq catégories : un événement qui n'en porte que trois ferait diverger ce que l'utilisateur voit à l'écran de ce qu'il lit dans son rapport
- Les trois catégories d'ARCHITECTURE.md ont été écrites avant que le découpage n'établisse qu'un transfert pouvait échouer sans que le morceau soit introuvable
- Une documentation qui décrit un contrat qu'elle ne porte plus est plus coûteuse qu'une correction faite au moment où l'écart apparaît
