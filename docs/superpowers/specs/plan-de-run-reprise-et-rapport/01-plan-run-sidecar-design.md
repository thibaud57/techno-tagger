---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "plan-run-sidecar"
goal: "Persister au fil de l'eau, dans appLocalDataDir(), un plan JSON versionné qui consigne chaque décision d'un run de tagging, puis purger au démarrage les plans qui ne servent plus"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-10-12"
---

# Plan de run persisté

## Scope

Ce sub-project persiste, dans `appLocalDataDir()/plans`, un plan JSON versionné qui consigne chaque décision d'un run de tagging jusqu'à sa confirmation, le relit en refusant une version inconnue (ADR-018, option A) et en gère le cycle de vie : création à l'ouverture du run, marque `committed` à `commit_run`, suppression quand un nouveau run remplace l'ancien, conservation à l'arrêt, purge au démarrage du sidecar. Il exclut la détection d'un run interrompu et sa reconstruction (sub-project 02), les commandes et événements NDJSON qui exposent le plan (04) et toute interface. Le plan ne porte ni la clé API ni le chemin de la pochette dans le cache.

### État livré

À la fin de ce sub-project, on peut lancer `just test` et voir passer des tests d'intégration NDJSON. Un run piloté par `stdin` y laisse sous `plans/` un plan qui suit sa validation automatique, son arbitrage et son rattrapage par URL. `shutdown` et `cancel_run` conservent ce plan, un second `start_tagging` supprime le plan précédent, `commit_run` marque le plan confirmé et la purge du démarrage efface les plans confirmés ou de plus de 30 jours.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/plan.py`. Le stub cède la place à :
  - les modèles `RunPlan` (avec sa fabrique `RunPlan.opened`), `PlanTrack`, `PlanQuery`, `PlanScores`, `PlanScored`, `PlanSourceList`, `PlanArbitration`, `PlanThresholds` ;
  - le `PlanRecorder` ;
  - les fonctions `plan_dir`, `plan_path`, `load_plan`, `discard_plan`, `purge_plans` ;
  - l'exception `RunPlanUnreadableError`.
- **À créer** : `sidecar/src/tagger/run_files.py`. Il porte ce que les dumps et les plans partagent :
  - le nom `<horodatage>-<run_id>`, dont la date et le `run_id` se relisent ;
  - le tri du plus récent au plus ancien d'un dossier (`newest_first`) ;
  - l'écriture atomique, la relecture versionnée qui refuse une version inconnue et la suppression qui logue au lieu de lever ;
  - la durée de rétention (`RETENTION`), définie une seule fois.
- **À modifier** : `sidecar/src/tagger/tag_dump.py`, qui délègue à `run_files` tout ce qui précède sans changer de comportement.
- **À modifier** : `sidecar/src/tagger/tagging.py` :
  - `TrackRecord.decided` (et la fonction `is_decided` qui la porte) est la règle unique du « traité » ;
  - `LiveRun` reçoit un observateur appelé à chaque `update`.
- **À modifier** : `sidecar/src/tagger/handlers.py` :
  - `open_tagging` crée le recorder et écrit le plan initial, par `_open_plan(live, thresholds, *, started_at=None)` ;
  - `CurrentRun` porte le recorder, vide le plan à la fermeture et expose un abandon qui le supprime ;
  - `handle_commit_run` marque le plan confirmé et attend son vidage avant d'écrire, puis le rouvre sur `TagDumpError`.
- **À modifier** : `sidecar/src/tagger/__main__.py`. `_Session._replace` abandonne le run remplacé au lieu de le fermer et `main()` purge les plans après les dumps.
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.run_plan_unreadable`). `test_error_translations` exige la phrase de tout code d'erreur dès qu'il existe, donc avant le protocole du sub-project 04.
- **À créer** : `sidecar/tests/helpers/run_plans.py`, qui fabrique des plans en mémoire et sur disque (`RUN_ID`, `music`, `plan_of`, `save_plan`) et lit ceux du dossier de données isolé (`plan_files`, `only_plan`). Les tests du sub-project 02 le partagent sans le redéfinir.
- **À créer** : `sidecar/tests/unit/test_plan.py` (modèle, relecture, recorder, abandon, purge, décompte des traités).
- **À créer** : `sidecar/tests/unit/test_run_files.py` (nom horodaté, tri, écriture atomique).
- **À créer** : `sidecar/tests/unit/test_tagging_rules.py` (`TrackRecord.decided`, observateur de `LiveRun`).
- **À modifier** : `sidecar/tests/unit/test_main.py` (ordre de démarrage avec la purge des plans).
- **À créer** : `sidecar/tests/integration/test_ndjson_plan.py` (cycle de vie du plan piloté par `stdin`).
- **À modifier** : `sidecar/tests/integration/test_ndjson_write.py` : le plan d'un run porte le même `run_id` que son dump, donc la présence du dump se vérifie dans `dumps/` et non plus par un glob sur tout le dossier de données.
- **À modifier** : `docs/ARCHITECTURE.md` :
  - arborescence : `plan.py` et `run_files.py` ;
  - § Données : `appLocalDataDir()/plans`, avec un run terminé égal à un run confirmé ;
  - diagramme de séquence : la décision est écrite au plan ;
  - mode de panne « sidecar qui meurt pendant un run » : avant `commit_run` la reprise est proposée, après la restauration seule reste.

## Architecture approach

### Modèle

Le plan est fait de modèles Pydantic gelés en `extra="forbid"` (ADR-022, `.claude/rules/pydantic/modeles.md`).
- **`RunPlan`** porte :
  - `schema_version` (1), `run_id`, `folder`, `started_at` (`AwareDatetime`, en UTC) ;
  - `thresholds` (`floor`, `ceiling`), pour que la reprise classe les morceaux restants comme les premiers. Les seuils sont validés par `check_thresholds` : un plan aux seuils incohérents est illisible ;
  - `committed` ;
  - `tracks`, un dict par `track_id` dans l'ordre du dossier, qui garde la position des logs et du « N/M ».
  - La fabrique `RunPlan.opened(live, thresholds, started_at)` le construit depuis un run vivant.
- **`PlanTrack`** tient de quoi reconstruire le `TrackRecord` sans réseau :
  - `state`, `resolution`, `failure_reason` (`FailureReason` seul, aucun motif de fichier n'existant avant la confirmation), `source` ;
  - `query` (artiste, titre, origine) ;
  - `candidate`, le `TrackCandidate` tel que la résolution l'a retenu, donc refetché ;
  - `scores` (artiste, titre, moyenne, `version_mismatch`, `number_mismatch`) ;
  - `arbitration` : liste affichée, liste mise de côté, `beatport_unavailable`, `empty_reason`.
- **Ce qui reste hors du plan** :
  - la pochette, qui vit dans le cache jetable (ADR-013) ;
  - `identity` et `tags_before`, relus sur un fichier qui n'a pas bougé ;
  - `written` et `restorable`, qui n'existent qu'après la confirmation.

### Décompte des traités

La règle est écrite une seule fois, sur `TrackRecord.decided` (`tagging.is_decided` pour `PlanTrack`) : un morceau est traité quand il a un `state` ou un arbitrage en attente, sauf s'il est `unresolved` pour `source_unavailable`. Une source qui n'a pas répondu (panne, clé refusée) n'est pas une décision : le morceau repart sur le réseau à la reprise. Le décompte est une méthode du modèle, jamais un champ : un compteur stocké dériverait. Le pipeline sélectif et la reprise du sub-project 02 réutilisent la même propriété.

### Enregistrement

`LiveRun` accepte un observateur que `update` appelle avec le `TrackRecord`. Toutes les décisions y passent déjà :
- `_Runner.process` ;
- `Arbitration._show` et `_settle` ;
- `UrlRecovery.resolve`.

`tagging.py` ignore le module `plan`.

### `PlanRecorder`

- **Mise à jour** : il met à jour le `RunPlan` en mémoire et réveille une tâche de vidage unique, nommée et gardée par référence forte (`.claude/rules/python/asyncio.md`).
- **Vidage** : la tâche écrit le dernier état par `asyncio.to_thread` et reboucle tant qu'un changement est arrivé pendant l'écriture. Une rafale ne produit donc que quelques écritures, jamais deux en parallèle.
- **`flush()`** attend que le disque porte l'état courant.
- **Échec d'écriture** : un `OSError` est loggué en ERROR, en logfmt (`run=`, `reason=write_failed`, `errno=`), sans trace, sans chemin complet et sans titre (`.claude/rules/python/gestion-erreurs.md`, `.claude/rules/sentry/python.md`) : la trace d'un `OSError` porte le chemin du plan, sous le profil Windows de l'utilisateur. Le run continue et le vidage suivant retente.

### Écriture

L'écriture est atomique : JSON en UTF-8 dans un `.tmp` voisin, puis `replace` (`.claude/rules/python/fichiers-io.md`), comme le dump. Le fichier est `app_data_dir() / "plans" / "<horodatage>-<run_id>.json"`, horodaté par `started_at` au `TIMESTAMP_FORMAT` des rapports.

### Cycle de vie

| Moment | Ce qui arrive au plan |
|---|---|
| `open_tagging` | Le recorder est créé après `open_run` et le plan initial est écrit, tous morceaux en attente. Un dossier sans fichier audio n'a pas de plan |
| `commit_run` (`handle_commit_run`) | `committed` est posé, puis le vidage est attendu avant que `RunWriter.write()` ne touche un fichier (write-ahead, ARCHITECTURE § Patterns). Le recorder cesse ensuite d'enregistrer : écriture, relance et rollback ne réécrivent plus le plan |
| `TagDumpError` | Le dump a échoué sans toucher aucun fichier : le run redevient confirmable, `committed` repasse à faux et le plan est revidé |
| Run remplacé (`_Session._replace`) | Le plan non confirmé de l'ancien run est supprimé (abandon explicite, sans vidage préalable), puis le run est fermé. Un plan confirmé reste, la purge s'en charge |
| `shutdown`, EOF (`CurrentRun.close`) | Le plan est vidé et jamais supprimé : c'est le plan que la reprise cherchera |
| `cancel_run` | Rien de particulier : les morceaux non atteints restent en attente dans le plan, qui reste lui aussi |

### Relecture

`load_plan(path)` refuse en `RunPlanUnreadableError` un JSON illisible, une `schema_version` différente de 1, un modèle invalide et des seuils incohérents :
- code `run_plan_unreadable` ;
- params `file`, `found`, `expected` ;
- erreur dérivée de `TaggerError`.

La relecture passe par la brique que le dump utilise déjà (`run_files.read_versioned`), paramétrée par le modèle, la version et l'erreur. Le plan n'est jamais migré. La docstring nomme les deux politiques de l'ADR-018, refus pour le plan et migration pour le rapport, pour qu'on ne les aligne pas.

### Purge

`purge_plans(folder, now)` est appelée dans `main()` après `_purge_old_dumps`, avec la même garde `OSError`. Elle ne fait jamais échouer le démarrage. Pour chaque fichier du dossier :

| Fichier | Traitement |
|---|---|
| `.tmp` orphelin | supprimé : l'instance unique garantit qu'aucun écrivain ne tourne au démarrage |
| plus de 30 jours selon l'horodatage du nom | supprimé sans être ouvert |
| plan `committed` | supprimé |
| plan illisible ou de version inconnue | gardé jusqu'à ses 30 jours, pour que le sub-project 02 l'annonce |
| plan ouvert | gardé |
| nom non reconnu | ignoré |

Un fichier verrouillé est loggué en WARNING et ne bloque pas les suivants.

### Factorisation

`run_files.py` reprend de `tag_dump.py` le nom horodaté et sa relecture, l'écriture atomique, la relecture versionnée, la suppression qui logue, le tri du plus récent au plus ancien et la durée de rétention. `tag_dump.py` garde ses journaux, ses suffixes et ses erreurs (`dumps_newest_first` reste son point d'entrée, appelé par `rollback.py`) et ses tests existants restent verts sans modification. La suppression d'un plan impossible à supprimer (`discard_plan`) vit dans `plan.py`.

### Types et conventions

`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/python/imports-modules.md`, `.claude/rules/python/stdlib-donnees.md`, `.claude/rules/ruff/lint-format.md`. Tests selon `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : une validation automatique entre au plan
**GIVEN** un dossier de deux morceaux, dont « Dim Orbit » trouvé sur Beatport au-dessus du seuil haut
**WHEN** `start_tagging` est envoyé sur `stdin` et que la phase réseau se termine
**THEN** `plans/` contient un seul plan `<horodatage>-<run_id>.json` portant le `run_id` de `run_started`
**AND** « Dim Orbit » y est `resolved`, en voie `auto`, avec la source, le candidat retenu et ses scores, sans chemin de pochette

### Scénario 2 : un arbitrage en attente puis tranché
**GIVEN** un morceau en zone grise sur Beatport
**WHEN** la phase réseau le met en attente, puis que `resolve_arbitration` retient le premier candidat
**THEN** le plan a d'abord porté la liste Beatport affichée, puis porte le morceau `resolved` en voie `arbitration`, sans arbitrage en attente

### Scénario 3 : un rattrapage par URL
**GIVEN** un morceau `unresolved` en `no_result`
**WHEN** `resolve_by_url` le résout sur Bandcamp
**THEN** le plan porte le morceau `resolved` en voie `url`, avec la source `bandcamp` et sans scores

### Scénario 4 : l'arrêt conserve le plan
**GIVEN** un run de deux morceaux dont la phase réseau est retenue sur le second
**WHEN** `shutdown` est envoyé
**THEN** le plan reste sur le disque, un morceau traité et l'autre en attente, avec `committed` à faux

### Scénario 5 : un nouveau run remplace l'ancien
**GIVEN** un run terminé côté réseau, non confirmé, avec son plan
**WHEN** un second `start_tagging` est envoyé
**THEN** le plan du premier run a disparu et seul celui du second existe

### Scénario 6 : la confirmation précède l'écriture
**GIVEN** un run résolu et son plan
**WHEN** `commit_run` est envoyé
**THEN** le plan porte `committed` avant que le premier fichier musical soit écrit
**AND** si l'enregistrement du dump échoue, le plan repasse à `committed` faux et le run reste confirmable

### Scénario 7 : purge au démarrage
**GIVEN** sous `plans/` :
- un plan confirmé d'hier ;
- un plan ouvert de 3 jours ;
- un plan ouvert de 31 jours ;
- un plan de version 2 de 3 jours ;
- un `.tmp` orphelin.

**WHEN** le sidecar démarre
**THEN** seuls restent le plan ouvert de 3 jours et le plan de version 2

### Scénario 8 : plan d'une version inconnue
**GIVEN** un plan dont la `schema_version` vaut 2
**WHEN** on le relit
**THEN** `RunPlanUnreadableError` est levée, code `run_plan_unreadable`, ses `params` nommant le fichier, la version trouvée et la version attendue

### Scénario 9 : écriture du plan en échec
**GIVEN** un dossier `plans/` où l'écriture lève un `OSError` dont le nom de fichier est un chemin du profil de l'utilisateur
**WHEN** une décision arrive
**THEN** le run continue et l'événement de la décision part normalement
**AND** un log ERROR `run plan not written run=<run_id> reason=write_failed errno=<errno>` est écrit sans trace ni chemin et le vidage suivant retente

### Scénario 10 : un run arrêté par `cancel_run` garde son plan
**GIVEN** un run de deux morceaux dont la phase réseau est retenue sur le second
**WHEN** `cancel_run` est envoyé, puis que la session se ferme
**THEN** le plan reste sur le disque, un morceau traité et l'autre en attente, avec `committed` à faux

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_plan.py` :
  - `PlanTrack.of` rend, pour chaque décision (auto, arbitrage en attente avec liste mise de côté, URL, `unresolved`, en attente), les mêmes champs que le `TrackRecord`, sans pochette
  - un plan garde ses morceaux dans l'ordre du dossier
  - le décompte des traités compte les morceaux à `state` et ceux en attente d'arbitrage, jamais les autres ni un `unresolved` pour `source_unavailable`
  - le nom du plan porte son horodatage et son `run_id`
  - un plan écrit et relu est identique
  - une `schema_version` inconnue, un JSON corrompu, un modèle invalide et des seuils incohérents lèvent `RunPlanUnreadableError` (avec `found` et `expected` pour la version)
  - une rafale de mises à jour suivie de `flush()` laisse sur le disque le dernier état de chaque morceau, en peu d'écritures
  - une décision arrivée pendant une écriture en vol est écrite au vidage suivant
  - un `OSError` d'écriture est loggué en ERROR avec son `errno`, sans le chemin de son nom de fichier et le vidage suivant écrit le plan
  - `commit()` ne lève pas quand le plan ne s'écrit pas
  - le plan marqué `committed` n'enregistre plus les mises à jour suivantes et `reopen()` le rend confirmable
  - l'abandon supprime le fichier du plan et plus rien ne s'écrit, l'abandon d'un plan confirmé le garde
  - `discard_plan` supprime un plan et logue une suppression impossible sans lever
  - la purge supprime confirmés, plans de plus de 30 jours et `.tmp`, garde ouverts et illisibles récents, ignore un nom non reconnu et un dossier absent (horloge injectée)
  - la purge continue après un plan qu'elle ne peut pas supprimer et le logue
- `sidecar/tests/unit/test_run_files.py` :
  - la date et le `run_id` se relisent depuis un nom horodaté, quel que soit son suffixe, un nom non horodaté rendant `None`
  - le tri rend les fichiers du suffixe du plus récent au plus ancien, écarte les autres noms et rend une liste vide pour un dossier absent
  - l'écriture atomique ne laisse ni fichier partiel ni `.tmp` quand le remplacement échoue
- `sidecar/tests/unit/test_tagging_rules.py` :
  - `TrackRecord.decided` est vrai pour un morceau tranché, refusé ou en attente d'arbitrage, faux pour un morceau en attente ou dont la source n'a pas répondu
  - l'observateur d'un `LiveRun` reçoit chaque morceau mis à jour
- `sidecar/tests/unit/test_main.py` :
  - l'ordre de démarrage est `setup_logging`, `init_sentry`, `_purge_old_dumps`, `_purge_old_plans`, `run_loop`
  - une purge des plans en échec n'empêche pas le démarrage

### Integration
- `sidecar/tests/integration/test_ndjson_plan.py` :
  - une validation automatique, un arbitrage en attente, un arbitrage tranché et un rattrapage par URL sont au plan après leur événement (scénarios 1 à 3)
  - `shutdown` en pleine phase réseau garde le plan, les morceaux non atteints en attente (scénario 4)
  - `cancel_run` en pleine phase réseau garde le plan (scénario 10)
  - un second `start_tagging` supprime le plan du premier run (scénario 5)
  - un dossier sans fichier audio ne laisse aucun plan
  - `commit_run` laisse le plan `committed` avant la première écriture de fichier, un échec du dump le rouvre (scénario 6)
- `sidecar/tests/integration/test_ndjson_write.py` : le dump d'un run confirmé se trouve dans `dumps/`.

## Edge cases

- **Crash entre une décision et son vidage** : la dernière décision peut manquer au plan. Aucun fichier musical n'a été touché, la reprise la redemande.
- **Crash entre `commit()` et le dump** : le plan est `committed` mais le dump n'est pas encore enregistré, `RunWriter.write()` relisant d'abord les tags des morceaux à écrire. Le plan est alors purgé au démarrage suivant et la session de choix est perdue, sans qu'aucun fichier n'ait bougé. Le risque est accepté, la fenêtre durant le temps de relire les tags et aucun mécanisme n'est ajouté.
- **Vidage en échec au moment de `commit_run`** :
  - L'écriture des fichiers continue, car le plan est un filet, pas une condition.
  - Si le sidecar meurt ensuite pendant l'écriture, le plan reste non confirmé alors que des fichiers ont bougé.
  - Le dump du même `run_id`, créé avant la première écriture, en témoigne : c'est au sub-project 02 de le vérifier avant de proposer une reprise.
- **Run arrêté par `cancel_run`** : il garde son plan, comme un run interrompu par une fermeture. La reprise le propose et relance les recherches des morceaux non atteints, ce qui coûte du quota (décision du 2026-10-12).
- **Morceau dont la source n'a pas répondu** (`unresolved` pour `source_unavailable`, dont les deux premiers 403 d'une clé révoquée) : le plan le consigne mais ne le compte pas parmi les traités, la reprise le renvoie sur le réseau.
- **Rétention** : les 30 jours se comptent depuis le `started_at` du plan, même repris. Un run repris au vingt-neuvième jour est purgé au trente-et-unième, ce que la reprise n'allonge pas.
- **Dossier sans fichier audio** : pas de plan, il n'y a rien à reprendre.
- **Rollback dans la session** : le plan est déjà confirmé et n'est pas réécrit.
- **Dossier `plans/` absent** : la purge n'a rien à faire et le dossier est créé au premier vidage.
- **Plan illisible de plus de 30 jours** : supprimé sur l'horodatage de son nom, sans être ouvert.
- **Horloge** : `started_at` et l'horodatage du nom sont en UTC (`datetime.now(UTC)`).

## Architectural decisions

### Décision : frontière entre run interrompu et run terminé
**Options envisagées :**
- **A. Terminé dès `commit_run`** : seul un run jamais confirmé se reprend. La promesse « aucun fichier touché » reste vraie et la restauration couvre un crash pendant l'écriture.
- **B. Terminé à la fin de l'écriture** : un crash pendant l'écriture laisse un plan reprenable pour finir d'écrire, mais des fichiers ont déjà bougé.
- **C. Terminé sans `write_error` restant** : un run écrit avec des échecs se reprend pour relancer l'écriture, ce qui fait un plan qui survit à la confirmation.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le message de reprise de l'ADR-010 affirme qu'aucun fichier n'a été touché : seule l'option A le garantit.
- Le dump vit 30 jours quel que soit l'état du run, donc un run confirmé reste annulable sans son plan.

### Décision : stratégie d'écriture
**Options envisagées :**
- **A. Snapshot réécrit atomiquement par une tâche de vidage qui fusionne les rafales** : un seul document JSON, simple à relire et à purger.
- **B. Journal NDJSON append-only, relu par rejeu** : écriture constante par décision, mais format et relecture plus complexes et le plan n'est plus un document unique.
- **C. Écriture synchrone dans `LiveRun.update`** : la plus simple, mais elle bloque la boucle à chaque décision, contre `.claude/rules/python/asyncio.md`.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Un plan de 100 morceaux pèse environ 150 ko (mesuré le 2026-10-12, JSON indenté, candidats de test complets, soit environ 1,5 ko par morceau) : réécrire tout le plan coûte moins que maintenir un rejeu et la fusion des rafales borne le nombre d'écritures.
- La relecture du sub-project 02 et la purge lisent un seul modèle Pydantic.

### Décision : contenu du plan
**Options envisagées :**
- **A. Plan autosuffisant** : candidat retenu complet, scores, requête et arbitrage en attente. La reprise reconstruit le run sans réseau pour tout morceau déjà traité.
- **B. Décisions humaines seules** : la reprise relance le pipeline et réapplique les gestes. Un plan plus petit, mais qui dépend du cache, jetable et peut rendre d'autres candidats que ceux vus.

**Choix : A**

**Rationale :**
- La reprise doit rendre exactement le run que l'utilisateur a quitté, arbitrages en attente compris.
- Le cache peut être vidé entre deux sessions (ADR-013) et le plan ne doit pas en dépendre.
