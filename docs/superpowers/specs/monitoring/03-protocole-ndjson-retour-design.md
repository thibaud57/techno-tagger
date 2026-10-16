---
feature: "Feature 9 : Monitoring"
subproject: "protocole-ndjson-retour"
goal: "Exposer à l'interface, par le protocole NDJSON, l'URL de l'issue de retour d'un run et le chemin de son export nettoyé, préparés à la demande par le sidecar."
status: "draft"
complexity: "M"
tdd_scope: "full"
depends_on: ["02-issue-de-retour-sidecar-design.md"]
date: "2026-10-16"
---

# Contrat NDJSON de l'issue de retour

## Scope

Ce sub-project fige dans le contrat NDJSON la commande `prepare_feedback { run_id }` et l'événement `feedback_ready { run_id, url, export_path }`. Le sidecar retrouve le rapport du run par l'index des rapports, écrit son export et construit l'URL de l'issue. Côté webview, il livre le miroir TypeScript, la méthode `prepareFeedback` de `SidecarService`, ses signaux `feedbackReady` et `feedbackPending` et la mise à jour du stub et du contrat dans `ARCHITECTURE.md`.

Exclus : le bouton de l'écran récapitulatif, l'ouverture du navigateur par `openUrl` et de l'Explorateur par `revealItemInDir`, l'affichage des erreurs (`04-bouton-envoyer-rapport-ui`). La construction de l'URL et de l'export reste celle de `02-issue-de-retour-sidecar`.

### État livré

À la fin de ce sub-project, on peut, par l'injection NDJSON et sans interface : écrire un run, envoyer `prepare_feedback` avec son `run_id`, recevoir `feedback_ready` dont l'URL fait au plus 2048 caractères et dont `export_path` désigne un fichier présent dans `feedback/`, puis recevoir `run_not_found` avec son `run_id` pour un run inconnu.

## Dependencies

- `02-issue-de-retour-sidecar-design.md` (statut: draft) : `feedback_issue_url`, `write_feedback_export`, `feedback_dir` et `FeedbackExportWriteError`
- **Prérequis hors feature** : `feature/settings` doit être commitée avant la Feature 9. `settings.admin.starting` (consommée par `04-bouton-envoyer-rapport-ui`), les modifications de `sidecar.service.ts`, `sidecar.service.spec.ts`, `sidecar-stub.ts`, des fichiers i18n et de `docs/ARCHITECTURE.md` n'existent que dans son working tree au 2026-10-16. Les commits de ce sub-project, qui touchent ces mêmes fichiers, n'embarquent ainsi aucun changement étranger

## Files touched

- **À modifier** : `sidecar/src/tagger/protocol.py` :
  - commande `PrepareFeedback` ;
  - événement `FeedbackReady` ;
  - unions `AnyCommand`, `ExecutableCommand`, `CommandName`.
- **À modifier** : `sidecar/src/tagger/handlers.py` :
  - `_report_of(run_id)`, recherche du rapport par l'index, partagée avec `handle_load_run` ;
  - `handle_prepare_feedback`.
- **À modifier** : `sidecar/src/tagger/__main__.py` :
  - un `case PrepareFeedback()` dans `_dispatch` ;
  - `_error_of` : le `run_id` d'une commande `PrepareFeedback`, comme celui de `LoadRun`.
- **À modifier** : `src/app/core/sidecar/protocol.ts` (`PrepareFeedbackCommand`, `FeedbackReadyEvent`, unions `SidecarCommand` et `SidecarEvent`)
- **À modifier** : `src/app/core/sidecar/sidecar.service.ts` :
  - signaux `feedbackReady`, `feedbackPending` ;
  - méthode `prepareFeedback(runId)` ;
  - `KNOWN_EVENTS`, `handleLine`, routage de l'erreur et de la perte du moteur.
- **À modifier** : `src/app/core/sidecar/sidecar.service.spec.ts`
- **À modifier** : `src/fixtures/sidecar-stub.ts` (nouveaux membres publics du service dans `defaults()`)
- **À créer** : `sidecar/tests/integration/test_ndjson_feedback.py`
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : ligne de la commande, ligne de l'événement, erreurs possibles)

## Architecture approach

### Conventions du protocole

`PrepareFeedback` hérite de `Command` (`extra="forbid"`, `strict=True`, ADR-022), `FeedbackReady` d'`Event` (`frozen`). Le sidecar n'émet aucune phrase, seulement un `code` et des `params` (`.claude/rules/pydantic/modeles.md`). Le miroir `protocol.ts`, les littéraux de test et le stub suivent dans la même tâche (`.claude/rules/typescript/types.md`).

### Côté sidecar

- **`_report_of(run_id) -> TaggingReport`**, synchrone : cherche l'entrée du run dans `list_reports(index_path())`, lève `RunNotFoundError` si elle manque, puis relit le rapport par `load_tagging_report`, qui migre un schéma antérieur et lève `TaggingReportUnreadableError` sur un rapport illisible. `handle_load_run` l'appelle par `asyncio.to_thread` au lieu de répéter la recherche
- **`handle_prepare_feedback(command) -> FeedbackReady`**, synchrone : `_report_of`, puis `write_feedback_export(feedback_dir(), report, RELEASE)`, puis `feedback_issue_url(report, RELEASE, export.name)`. L'export s'écrit avant l'URL : celle-ci nomme le fichier à glisser
- **Dans `_dispatch`** : `session.send(await asyncio.to_thread(handle_prepare_feedback, command))`, attendu par la boucle comme `list_runs` (`.claude/rules/python/asyncio.md`). Quelques millisecondes : un rapport de quelques centaines de Ko relu, un fichier écrit
- **Pas de garde de phase** : la commande ne touche ni la musique, ni le cache, ni le plan. Elle est acceptée pendant une extraction, une phase réseau ou une écriture
- **Erreurs** : `run_not_found`, `tagging_report_unreadable` et `feedback_export_write_failed`, toutes trois déjà traduites. `_error_of` y ajoute le `run_id` de la commande, comme pour `load_run` : l'interface rattache le refus au run affiché et non au dernier demandé

### Côté webview

- **`prepareFeedback(runId)`** ne part que moteur disponible, comme `loadRun` : sans moteur, rien n'est envoyé et aucune erreur n'est posée, `reportUnavailable` arrêtant sinon le run affiché (`endRun`). Un second appel pour le run déjà en préparation est ignoré
- **`feedbackPending`** (`string | null`) : le `run_id` en préparation, posé à l'envoi, effacé sur `feedback_ready`, sur une `error` de `prepare_feedback` et sur la perte du moteur (`endRun`). Le bouton de 04 en tire son spinner
- **`feedbackReady`** (`FeedbackReadyEvent | null`) : le dernier `feedback_ready`. Le composant de 04 l'observe pour ouvrir l'issue et révéler l'export
- **Erreurs** : par `errorFor("prepare_feedback")`, déjà en place
- Signaux privés exposés en lecture seule (`.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`). `feedback_ready` entre dans `KNOWN_EVENTS` et `handleLine`, dont le `never` rend l'oubli visible à la compilation
- **Pas de store dédié** : `_feedbackReady` et `_feedbackPending` restent dans `SidecarService`, deux signaux sans machine d'états, sur le précédent de `_cacheCleared` et `_cacheClearing` (réponse unique à une commande, Réglages). Un store par phase (`.claude/rules/angular/services.md`) se justifie pour un état qui évolue au fil d'événements, ce qui n'est pas le cas ici

### Rules applicables

`.claude/rules/pydantic/modeles.md`, `.claude/rules/python/asyncio.md`, `.claude/rules/python/gestion-erreurs.md`, `.claude/rules/python/pattern-matching.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/imports-modules.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/typescript/types.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/tests.md`, `.claude/rules/angular/rxjs-interop.md`

## Acceptance criteria

### Scénario 1 : run qui vient d'être écrit
**GIVEN** un run écrit, son rapport enregistré dans l'index
**WHEN** l'interface envoie `prepare_feedback` avec son `run_id`
**THEN** le sidecar émet `feedback_ready` portant ce `run_id`
**AND** `url` cible l'Issue Form `matching-report.yml` et fait au plus 2048 caractères
**AND** `export_path` désigne un fichier présent dans `feedback/`, que l'URL nomme

### Scénario 2 : run passé, après redémarrage
**GIVEN** un run écrit lors d'une session précédente
**WHEN** l'interface envoie `prepare_feedback` avec son `run_id`
**THEN** le sidecar émet `feedback_ready`

### Scénario 3 : run inconnu
**GIVEN** un `run_id` absent de l'index
**WHEN** l'interface envoie `prepare_feedback`
**THEN** le sidecar émet `error` de code `run_not_found` pour la commande `prepare_feedback`, `run_id` compris

### Scénario 4 : export impossible à écrire
**GIVEN** un run écrit et un dossier `feedback` qu'il est impossible de créer
**WHEN** l'interface envoie `prepare_feedback`
**THEN** le sidecar émet `error` de code `feedback_export_write_failed` qui nomme le fichier

### Scénario 5 : pendant une phase réseau
**GIVEN** une phase réseau en cours sur un autre dossier et un run passé
**WHEN** l'interface envoie `prepare_feedback` pour le run passé
**THEN** le sidecar émet `feedback_ready`, la phase réseau continue

### Scénario 6 : routage côté interface
**GIVEN** `SidecarService` connecté au moteur
**WHEN** `prepareFeedback` est appelé puis `feedback_ready` arrive
**THEN** `feedbackPending` vaut le run pendant l'attente, puis `null`
**AND** `feedbackReady` porte l'événement reçu

## Tests à écrire

### Unit

- `sidecar/tests/unit/test_protocol_models.py` : aucune modification. Le test existant `test_command_name_lists_every_command` échoue seul tant que `CommandName` n'est pas étendu de `prepare_feedback`
- `src/app/core/sidecar/sidecar.service.spec.ts` :
  - `prepareFeedback()` envoie sa commande (`it.each` existant)
  - sans moteur, `prepareFeedback()` n'envoie rien, ne pose aucune erreur et n'arrête pas le run affiché
  - `feedbackPending` vaut le run pendant l'attente et retombe sur `feedback_ready`
  - `feedbackPending` retombe sur une `error` de `prepare_feedback` et sur la perte du moteur
  - un second `prepareFeedback()` pour le run en préparation n'envoie rien
  - `feedback_ready` pose `feedbackReady`

### Integration

- `sidecar/tests/integration/test_ndjson_feedback.py` :
  - un run écrit donne `feedback_ready`, URL bornée et export présent, nommé dans l'URL
  - un run passé, relu après une nouvelle session, donne `feedback_ready`
  - un run inconnu donne `run_not_found`, `run_id` compris
  - un rapport supprimé du disque donne `run_not_found`, `run_id` compris (l'index écarte l'entrée)
  - un rapport au contenu corrompu donne `tagging_report_unreadable`, `run_id` compris
  - un dossier `feedback` impossible à créer donne `feedback_export_write_failed`
  - la commande est acceptée pendant une phase réseau, qui va au bout

## Edge cases

- **Rapport non écrit** (`run_finished.report_path` nul) : le run n'est pas dans l'index, `prepare_feedback` rend `run_not_found`. Le bouton de 04 est grisé dans ce cas, jamais masqué
- **Run restauré par rollback** : son rapport réécrit reste dans l'index, l'export et l'URL décrivent l'état restauré
- **Rapport supprimé du disque après coup** : `list_reports` écarte une entrée dont le fichier n'existe plus (`reports/index.py`), `run_not_found` remonte avec le `run_id`
- **Rapport corrompu ou d'une version future** : l'entrée est dans l'index, `load_tagging_report` lève, `tagging_report_unreadable` remonte avec le `run_id`
- **Export impossible à écrire** : échec total, ni `feedback_ready` ni URL, seulement `feedback_export_write_failed`. L'issue ne s'ouvre pas sans son export
- **Deux clics rapides** : le second est ignoré côté webview tant que `feedbackPending` vaut ce run. Arrivé jusqu'au sidecar, il réécrirait le même export, sans dommage

## Architectural decisions

### Décision : préparation à la demande ou à la fin du run

**Options envisagées :**
- **A. À la demande, par `prepare_feedback`** : rien n'est écrit tant que l'utilisateur ne clique pas, un run passé se partage comme le run courant
- **B. À la fin de l'écriture, l'URL portée par `run_finished`** : aucune commande de plus, mais un export écrit à chaque run sans qu'on l'ait demandé et rien pour un run passé

**Choix : A**

**Rationale :**
- Le geste explicite reste la seule entrée : rien ne se prépare pour partir sans que l'utilisateur l'ait demandé (ADR-014)
- Le récapitulatif d'un run passé (`load_run`) porte le même bouton, avec le même chemin
