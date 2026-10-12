---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "reprise-run-sidecar"
goal: "Détecter au lancement un run interrompu puis le résumer, reconstruire son état en mémoire depuis son plan pour ne relancer que les morceaux jamais traités, ou l'abandonner"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-plan-run-sidecar-design.md"]
date: "2026-10-12"
---

# Reprise d'un run interrompu

## Scope

Ce sub-project détecte le plan interrompu le plus récent, qu'il résume en un run reprenable (date, dossier, N/M traités, dossier introuvable ou non) ou en un plan illisible et ignore le run ouvert dans la session. Il reconstruit le run en mémoire depuis son plan sur le contenu actuel du dossier : les décisions et les arbitrages en attente sont rendus, les pochettes retéléchargées et les événements d'un run vivant rejoués, le pipeline réseau ne traitant ensuite que les morceaux sans décision. Il exclut les commandes `resume_run` et `discard_run`, l'événement qui annonce le plan détecté et leur câblage dans la session (sub-project 04), l'invite de l'interface (05), ainsi que la suppression d'un plan (`plan.discard_plan`, livrée par le sub-project 01).

### État livré

À la fin de ce sub-project, on peut lancer `just test` et voir passer un test qui part d'un plan à 62 morceaux traités sur 100, reconstruit le run et lance la phase réseau sur l'API simulée. Seules 38 recherches partent. La progression va de 62 à 100 et les décisions comme les arbitrages en attente du plan restent intacts.

## Dependencies

- `01-plan-run-sidecar-design.md` (statut: draft) : `RunPlan`, `PlanTrack`, `PlanArbitration`, `PlanThresholds`, `processed_count`, `plan_dir`, `load_plan`, `discard_plan`, `RunPlanUnreadableError`, `TrackRecord.decided`, `run_files.created_at_of`, `run_id_of` et `newest_first`, les helpers de test `run_plans` et le cycle de vie du plan (un seul plan ouvert à la fois, un plan confirmé est terminé, `cancel_run` garde le plan).

## Files touched

- **À créer** : `sidecar/src/tagger/resume.py`. Il contient `InterruptedRun`, `UnreadablePlan`, `DetectedPlan`, `detect_interrupted`, `find_plan` et `reopen_run`.
- **À modifier** : `sidecar/src/tagger/plan.py`, qui gagne :
  - les conversions inverses `PlanQuery.to_query`, `PlanScores.applied_to`, `PlanScored.to_scored`, `PlanSourceList.to_source_list`, `PlanArbitration.to_pending`, `PlanThresholds.to_matching` et `PlanTrack.applied_to` ;
  - `plans_newest_first`, le tri des plans d'un dossier.
- **À modifier** : `sidecar/src/tagger/tagging.py`, sur deux points :
  - `_read_identities` devient `read_identities`, appelée par `reopen_run` ;
  - `resolve_run` ne traite que les morceaux non décidés (`TrackRecord.decided`) et son compteur part du nombre déjà traité.
- **À modifier** : `sidecar/src/tagger/sources.py`. `_artwork` devient `artwork`, appelée par `reopen_run`.
- **À créer** : `sidecar/tests/unit/test_resume.py` (détection, désignation, reconstruction, état livré).
- **À modifier** : `sidecar/tests/unit/test_plan.py` (conversions inverses).
- **À modifier** : `sidecar/tests/unit/test_tagging_run.py` (un morceau déjà tranché n'est jamais renvoyé à l'API, un morceau dont la source n'a pas répondu l'est).
- **À modifier** : `sidecar/tests/helpers/tagging_api.py`, avec `run_sources` : les `RunSources` d'un run déjà ouvert, sur l'API et le CDN simulés. Les fabriques de plans (`run_plans`) existent déjà depuis le sub-project 01.
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence : `resume.py`).

## Architecture approach

### Détection

`detect_interrupted(plans: Path, dumps: Path, *, active_run_id: str | None = None) -> DetectedPlan | None` parcourt les plans du plus récent au plus ancien, selon l'horodatage du nom (`plan.plans_newest_first`, sur `run_files.newest_first`). Elle ignore les noms non horodatés et les `.tmp`.

| Plan rencontré | Traitement |
|---|---|
| `run_id` égal à `active_run_id` | passé : c'est le run ouvert dans la session, il n'est pas interrompu |
| `committed` | passé : la purge du démarrage l'a normalement déjà supprimé |
| ouvert, avec un dump du même `run_id` (`tag_dump.find_dump`) | des fichiers ont bougé, il est traité comme terminé : supprimé avec un log WARNING `run plan dropped run=<run_id> reason=files_written`, puis l'on passe au suivant. La restauration reste offerte dans les Réglages |
| illisible ou de version inconnue | rendu en `UnreadablePlan` |
| ouvert, sinon | rendu en `InterruptedRun` |

Seul le premier plan retenu est rendu : un plan plus ancien attend le lancement suivant, puis la purge à 30 jours.

### Résumés

Ce sont deux `dataclass(frozen=True, slots=True)` (`.claude/rules/python/modeles-donnees.md`) :
- **`InterruptedRun`** porte `path`, `run_id`, `started_at`, `folder`, `processed`, `total` et `folder_missing`. Tout est tiré du plan, sauf `folder_missing`, vrai quand `files.list_audio_files(plan.folder)` lève `TaggingFolderUnreadableError` (dossier absent ou débranché) ou ne rend aucun fichier (dossier vidé). Un dossier introuvable rend le plan non reprenable : l'interface n'offre que de repartir de zéro et un disque rebranché le rend reprenable au lancement suivant.
- **`UnreadablePlan`** porte `path`, `run_id` et `started_at`, lus sur le nom, plus `error`, la `RunPlanUnreadableError` dont le code et les params (`file`, `found`, `expected`) font le message de l'ADR-018.

`DetectedPlan` est l'union des deux.

### Désignation et abandon

- **`find_plan(plans, run_id) -> Path | None`** compare le `run_id` lu sur le nom, comme `tag_dump.find_dump`, jamais par glob. Le sub-project 04 s'en sert pour `resume_run` et `discard_run`.
- **L'abandon** est `plan.discard_plan(path)` (sub-project 01) : un `OSError` est loggué en WARNING (`run plan not discarded run=<run_id> reason=unlink_failed`) sans être levé, le plan sera reproposé au lancement suivant et rien n'est perdu.

### Reconstruction

`reopen_run(plan: RunPlan, sources: RunSources, *, on_event) -> LiveRun` est le pendant de `open_run`.

1. **Relecture du dossier** : `list_audio_files(plan.folder)` puis `read_identities`, par `asyncio.to_thread` comme dans `open_run` (`.claude/rules/python/asyncio.md`). Un dossier introuvable lève l'erreur existante `TaggingFolderUnreadableError`, un dossier sans aucun fichier audio aussi : il n'y a plus rien à reprendre et aucun événement n'est émis.
2. **Application du plan** : chaque `track_id` du plan dont le morceau est décidé reçoit sa décision par `PlanTrack.applied_to(record)`, qui rend `state`, `resolution`, `failure_reason`, `source`, `query`, `candidate`, `scored` et `arbitration`.
   - Le `ScoredCandidate` reconstruit porte le candidat retenu et les scores du plan.
   - Un fichier absent du plan entre en attente, ainsi qu'un morceau que le plan ne compte pas parmi les traités (`unresolved` pour `source_unavailable`).
   - Un `track_id` du plan sans fichier sort du run, avec un log WARNING `reason=file_missing`, sa clé `track` étant sa position dans le plan.
3. **Annonce** : `RunStarted(plan.run_id, folder, tous les morceaux)` part avant tout téléchargement, comme dans un run neuf où l'ouverture précède les pochettes : la liste s'affiche sans attendre le réseau.
4. **Pochettes** : celles des morceaux résolus sont retéléchargées en parallèle par `RunSources.artwork(position, candidate)` (`asyncio.TaskGroup`, pool des pochettes déjà borné par `ArtworkFetcher`). Le cache sert d'abord et un échec laisse le morceau sans pochette, sans le faire échouer (`.claude/rules/httpx2/client.md`).
5. **Rejeu** des décisions, dans l'ordre du dossier : un `TrackResolved` par morceau tranché et un `ArbitrationRequired` par arbitrage en attente, puis `RunProgress(décidés, total)`.

   L'interface reçoit les événements d'un run vivant : le sub-project 04 n'a rien à traduire de nouveau.
6. **Résultat** : un `LiveRun(plan.run_id, folder, records)`, sur lequel `Arbitration` et `UrlRecovery` fonctionnent sans changement.

### Seuils et suite du plan

- **Seuils** : `PlanThresholds.to_matching()` rend les seuils du run, déjà validés à la relecture du plan. Le sub-project 04 construit les `RunSources` avec eux, pas avec ceux de la commande.
- **Suite du plan** : 04 rebranche un `PlanRecorder` par `_open_plan(live, thresholds, started_at=plan.started_at)`. Le même `run_id` et le même `started_at` donnent le même fichier, réécrit au premier vidage sur le contenu actuel du dossier.

### Pipeline sélectif

`resolve_run` ne lance une tâche que pour les morceaux non décidés (`TrackRecord.decided` faux), à leur position dans le dossier (`live.position`). `_Runner` reçoit le nombre déjà traité : `RunProgress` continue de N à M au lieu de repartir de 0. Un run neuf ne change pas de comportement, puisque tous ses morceaux sont sans décision.

### Conventions

- Erreurs et logs : `.claude/rules/python/gestion-erreurs.md`, jeu de clés logfmt fixe, jamais de titre.
- Modèles : `.claude/rules/pydantic/modeles.md`.
- Types : `.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/python/pattern-matching.md` (`match` sur `DetectedPlan`).
- Imports : `.claude/rules/python/imports-modules.md`.
- Fichiers : `.claude/rules/python/fichiers-io.md`.
- Lint : `.claude/rules/ruff/lint-format.md`.
- API : `.claude/rules/techno-scraper/contrat.md`.
- Tests : `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : un run interrompu est résumé
**GIVEN** sous `plans/` un plan ouvert du 2 août sur un dossier présent qui contient de l'audio, 62 morceaux traités sur 100, sans dump de son `run_id`
**WHEN** la détection passe
**THEN** elle rend un `InterruptedRun` portant son `run_id`, sa date, son dossier, `processed` 62, `total` 100 et `folder_missing` faux

### Scénario 2 : le dossier a disparu
**GIVEN** un plan ouvert dont le dossier n'existe plus
**WHEN** la détection passe
**THEN** elle rend un `InterruptedRun` avec `folder_missing` vrai et le plan reste sur le disque

### Scénario 3 : le dossier a été vidé
**GIVEN** un plan ouvert dont le dossier existe mais ne contient plus aucun fichier audio
**WHEN** la détection passe
**THEN** elle rend un `InterruptedRun` avec `folder_missing` vrai et le plan reste sur le disque
**AND** reconstruire ce run lève `TaggingFolderUnreadableError` sans émettre d'événement

### Scénario 4 : un plan d'une autre version
**GIVEN** un plan dont la `schema_version` vaut 2
**WHEN** la détection passe
**THEN** elle rend un `UnreadablePlan` dont l'erreur porte le code `run_plan_unreadable`, la version trouvée 2 et la version attendue 1

### Scénario 5 : des fichiers ont déjà bougé
**GIVEN** un plan ouvert dont le `run_id` a un dump sous `dumps/` et un plan ouvert plus ancien
**WHEN** la détection passe
**THEN** le premier plan est supprimé avec un log WARNING `reason=files_written`
**AND** la détection rend le plan plus ancien

### Scénario 6 : le run ouvert n'est pas interrompu
**GIVEN** un plan ouvert plus récent qui est celui du run ouvert dans la session (`active_run_id`) et un plan ouvert plus ancien
**WHEN** la détection passe
**THEN** elle rend le plan plus ancien et rien quand le plan du run ouvert est le seul

### Scénario 7 : reprise d'un run à 62 sur 100
**GIVEN** un plan à 62 morceaux tranchés ou en arbitrage, dont un arbitrage Beatport en attente avec sa liste Bandcamp mise de côté et 38 morceaux en attente, sur un dossier inchangé
**WHEN** le run est reconstruit puis que la phase réseau passe sur l'API simulée
**THEN** l'API ne reçoit que les 38 recherches des morceaux en attente
**AND** les événements rejoués annoncent 62 morceaux avant la première recherche et le dernier `RunProgress` vaut 100 sur 100
**AND** l'arbitrage en attente porte toujours ses deux listes, sans aucun appel réseau

### Scénario 8 : le dossier a changé
**GIVEN** un plan qui tranche `a.mp3` et `b.mp3`, alors que le dossier contient `a.mp3` et un nouveau `c.mp3`, mais plus `b.mp3`
**WHEN** le run est reconstruit
**THEN** le run contient `a.mp3` tranché et `c.mp3` en attente et `b.mp3` en est absent avec un log WARNING `reason=file_missing`

### Scénario 9 : une source qui n'avait pas répondu
**GIVEN** un plan dont un morceau est `unresolved` pour `source_unavailable` et un autre tranché
**WHEN** le run est reconstruit puis que la phase réseau passe
**THEN** le premier morceau est en attente, hors du décompte des traités (`RunProgress` à 1 sur 2) et part sur le réseau avec les morceaux sans décision

### Scénario 10 : abandon
**GIVEN** un plan détecté
**WHEN** il est abandonné par `plan.discard_plan`
**THEN** son fichier n'existe plus et une suppression impossible est logguée sans lever d'erreur

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_resume.py` :
  - aucun plan, ou un dossier `plans/` absent, rend `None`
  - un plan ouvert rend son résumé N/M avec sa date et son dossier (scénario 1)
  - un dossier introuvable ou vidé rend `folder_missing` vrai sans supprimer le plan (scénarios 2 et 3)
  - un plan illisible ou de version inconnue rend `UnreadablePlan` avec `found` et `expected` (scénario 4)
  - un plan qui a un dump est supprimé et la détection passe au suivant (scénario 5)
  - un plan `committed` est ignoré, un nom non horodaté et un `.tmp` sont ignorés
  - le plan le plus récent l'emporte sur un plus ancien, même illisible
  - le plan du run ouvert est ignoré et la détection ne rend rien quand c'est le seul (scénario 6)
  - `find_plan` trouve un plan par son `run_id` et rend `None` pour un `run_id` inconnu
  - la reconstruction rend chaque décision du plan, dont un arbitrage en attente avec sa liste mise de côté et un morceau d'un sous-dossier
  - la reconstruction met en attente un fichier nouveau et retire un fichier disparu en le loguant (scénario 8)
  - les événements rejoués suivent l'ordre `RunStarted`, décisions dans l'ordre du dossier, puis `RunProgress`
  - `RunStarted` part avant le premier téléchargement de pochette
  - les pochettes des morceaux résolus sont retéléchargées, une pochette indisponible laisse le morceau résolu
  - un dossier vidé ou introuvable lève `TaggingFolderUnreadableError` sans événement (scénario 3)
  - un morceau dont la source n'avait pas répondu repart en attente, hors du décompte (scénario 9)
  - un arbitrage reconstruit se tranche encore
  - reprise d'un plan à 62 sur 100 sur l'API simulée : 38 recherches, progression jusqu'à 100 sur 100, décisions intactes (scénario 7)
- `sidecar/tests/unit/test_plan.py` :
  - la décision enregistrée de chaque sorte (auto, arbitrage en attente, URL, non résolu, en attente) est rendue à l'identique sur le morceau relu, sans pochette
  - les seuils du plan redonnent ceux du run
  - l'abandon d'un plan le supprime et logue une suppression impossible sans lever (scénario 10, tests du sub-project 01)
- `sidecar/tests/unit/test_tagging_run.py` :
  - un morceau déjà tranché ou en attente d'arbitrage n'est jamais renvoyé à l'API
  - un morceau dont la source n'a pas répondu y est renvoyé

## Edge cases

- **Fichier modifié par un autre outil depuis le plan** : la décision s'applique toujours à son `track_id`. Identité et tags d'origine sont relus et l'écriture dumpera l'état actuel.
- **Tags devenus illisibles** : l'identité est vide, comme dans `open_run` et la décision du plan s'applique quand même.
- **Run arrêté par trois 403 consécutifs** : ses morceaux non atteints sont en attente dans le plan et les deux premiers 403, consignés `source_unavailable`, ne comptent pas comme traités. La reprise les relance tous, une fois la clé corrigée.
- **Run arrêté par `cancel_run`** : il garde son plan et est proposé à la reprise comme un run interrompu. La reprise relance les recherches des morceaux non atteints, ce qui consomme du quota (décision du 2026-10-12).
- **Refus manuel sur une liste Bandcamp vide pour `source_unavailable`** : le morceau est `unresolved` pour ce motif, donc non décidé à la reprise. Il repart sur le réseau et l'utilisateur peut le trancher de nouveau.
- **Arbitrage en attente dont le candidat est choisi après la reprise** : `Arbitration.choose` refetch et télécharge la pochette comme dans un run vivant.
- **Plusieurs plans ouverts** (suppression d'un run remplacé ratée) : seul le plus récent est proposé. Les autres viennent ensuite, ou partent à 30 jours.
- **Plan dont le dossier ne contient plus aucun fichier audio** : la détection le signale `folder_missing`, `reopen_run` lève `TaggingFolderUnreadableError`. L'interface n'offre que de repartir de zéro, qui supprime le plan.

## Architectural decisions

### Décision : reconstruction du run
**Options envisagées :**
- **A. `reopen_run` et rejeu des événements** : les mêmes événements qu'un run vivant et `resolve_run` ne traite que les morceaux sans décision.
- **B. Plan comme oracle dans le pipeline** : chaque morceau repasse dans `_Runner`, qui consulte le plan avant d'appeler l'API. C'est plus intrusif dans le pipeline, pour le même résultat.
- **C. Sans rejeu** : `run_started` porterait l'état de chaque morceau. Il faudrait un second chemin d'hydratation côté interface et un `TrackEntry` qui change de forme.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le contrat NDJSON et l'interface ne voient aucune différence entre un run repris et un run vivant.

### Décision : contenu du run repris
**Options envisagées :**
- **A. Dossier actuel** : décisions appliquées par `track_id`, fichiers nouveaux en attente, fichiers disparus retirés.
- **B. Plan strict** : seuls les morceaux du plan reviennent, un fichier disparu passe en échec et un fichier nouveau est ignoré.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- L'écriture ne vise que des fichiers présents et le run repris décrit le dossier tel qu'il est.

### Décision : plan dont les fichiers ont bougé
**Options envisagées :**
- **A. Traité comme terminé** : supprimé à la détection, jamais proposé. La restauration des Réglages couvre le cas.
- **B. Annoncé à part comme interrompu pendant l'écriture** : un cas et un message de plus pour une situation rare.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- La promesse de la reprise, qui affirme qu'aucun fichier n'a été touché, ne tiendrait plus.
