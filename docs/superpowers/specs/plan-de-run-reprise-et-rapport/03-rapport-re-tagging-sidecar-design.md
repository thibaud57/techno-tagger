---
feature: "Feature 6 : Plan de run, reprise et rapport"
subproject: "rapport-re-tagging-sidecar"
goal: "Écrire à la fin de chaque phase d'écriture un rapport de re-tagging JSON et Markdown dans le dossier du run, l'inscrire dans un registre local et savoir le relire"
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: ["01-plan-run-sidecar-design.md"]
date: "2026-10-12"
---

# Rapport de re-tagging

## Scope

Ce sub-project écrit le rapport de re-tagging d'un run (modèle versionné, rendu Markdown en anglais) dans le dossier du run, à la fin de `commit_run` puis à la fin de chaque `retry_write` sous les mêmes noms, jamais après un rollback. Il tient aussi le registre local des rapports écrits, qui alimentera la liste des runs passés, la relecture du rapport avec son point d'entrée de migration (ADR-018 option B) et la traduction du code d'erreur de relecture. Il exclut les chemins des rapports dans `run_finished`, `list_runs` et `load_run` (sub-project 04) ainsi que toute interface (06, 07) : le rapport reste la trace de ce qui a été écrit.

### État livré

À la fin de ce sub-project, on peut lancer `just test` et voir passer un test d'intégration NDJSON :
- un `commit_run` laisse `tagging-report-<horodatage>.json` et `.md` dans le dossier tagué, ainsi qu'une entrée dans `appLocalDataDir()/reports.json` ;
- le JSON relu rend le même rapport ;
- un `retry_write` réécrit les mêmes fichiers.

## Dependencies

- `01-plan-run-sidecar-design.md` (statut: draft) : `run_files.write_atomically` pour les fichiers du rapport et le registre, `plan.PlanScores` pour les scores consignés et `handle_commit_run` tel que 01 le réorganise (confirmation du plan avant l'écriture). C'est la seule dépendance : la reprise (02) n'intervient pas ici.

## Files touched

- **À créer** : `sidecar/src/tagger/tagging_report.py` :
  - modèles `TaggingReport`, `TaggingReportTrack`, `TaggingReportCounts`, `ReportQuery`, `ReportThresholds`, `ReportTagValue` (les scores réutilisent `plan.PlanScores`) ;
  - fonctions `build_tagging_report`, `render_tagging_markdown`, `report_paths`, `write_tagging_report`, `load_tagging_report` ;
  - projections `tag_rows` et `after_rows`, que `handlers.py` réutilise ;
  - erreur `TaggingReportUnreadableError`.
- **À créer** : `sidecar/src/tagger/report_index.py` (`ReportIndex`, `IndexEntry`, `index_path`, `record_report(index, entry)`, `list_reports(index)`).
- **À modifier** : `sidecar/src/tagger/reports.py`. Les briques communes deviennent publiques sans changer de comportement : `unused_report_paths`, `escape_markdown`, `table_section`, `table_row`, `format_instant`.
- **À modifier** : `sidecar/src/tagger/handlers.py` :
  - `CurrentRun` garde les noms choisis pour le rapport et les chemins du dernier rapport écrit ;
  - `handle_commit_run` et `handle_retry_write` écrivent le rapport à la fin de la phase ;
  - `_tags_before` et `_tags_after` délèguent à `tag_rows` et `after_rows` : une seule projection des lignes pour l'écran et pour le rapport.
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.tagging_report_unreadable`).
- **À créer** : `sidecar/tests/unit/test_tagging_report.py` (modèle, compteurs, aller-retour, refus, rendu Markdown, écriture).
- **À créer** : `sidecar/tests/unit/test_report_index.py` (ajout, remplacement, ordre, entrée disparue, registre illisible ou impossible à lire).
- **À créer** : `sidecar/tests/helpers/tagging_report_samples.py` (run couvrant toutes les issues).
- **À modifier** : `sidecar/tests/integration/test_ndjson_write.py` (rapport et registre après `commit_run` et `retry_write`, rapport impossible à écrire, absence de clé API).
- **À modifier** : `docs/ARCHITECTURE.md` :
  - arborescence : `tagging_report.py`, `report_index.py` ;
  - § Données : le rapport de run nommé `tagging-report-<horodatage>` vit dans le dossier du run et non dans le dossier destination et le registre `reports.json`.

## Architecture approach

### Modèle

Le rapport est un `TaggingReport` Pydantic gelé en `extra="forbid"` (ADR-022, `.claude/rules/pydantic/modeles.md`).

- **En-tête** : `schema_version` (1), `kind: Literal["tagging"]`, `generated_at` (`AwareDatetime`, UTC), `run_id`, `folder` et `thresholds` (plancher, seuil haut) pour recalibrer à la lecture (ADR-008).
- **`counts`** : `written`, `write_error`, `unresolved`, `rolled_back`, `not_processed`. Ce dernier couvre un morceau sans `state`, jamais atteint ou laissé en arbitrage. Chaque compteur se lit sur `state`, jamais sur l'absence d'un autre (même règle que `_run_finished`). Un morceau `resolved` n'existe plus à ce stade : l'écriture le fait passer en `written` ou `write_error`.
- **`tracks`** : un `TaggingReportTrack` par morceau, dans l'ordre du dossier :
  - `track_id` ;
  - `file_before` (le `track_id`, chemin d'origine relatif au dossier) et `file_after` (chemin après renommage, `None` si le fichier n'a pas été écrit) ;
  - `truncated` ;
  - `query` (texte envoyé et origine, `None` pour une requête vide) ;
  - `source`, `state`, `resolution`, `failure_reason` (motif réseau ou motif de fichier) ;
  - `scores` du candidat retenu, au format de `plan.PlanScores` (artiste, titre, moyenne, `version_mismatch`, `number_mismatch`, valeurs brutes) ;
  - `artist` et `title` écrits (règle de l'ADR-011, `credited_artists` et `full_title`) ;
  - `url` (fiche source) et `artwork_url` ;
  - `system` (`TagSystem` des tags d'origine, `None` quand ils étaient illisibles), `tags_before` (lignes champ, clé, valeur et commentaire) et `tags_after` (lignes champ, clé, valeur, projetées comme pour la colonne Après) ;
  - `fields_written` et leur nombre, `artwork_written`.
- **Un morceau restauré par rollback** (cas d'un `retry_write` qui suit un rollback partiel) est rapporté avec `file_before`, `tags_before`, `system` et `state` `rolled_back`. Ses champs de décision sont nuls, puisque la restauration les a effacés du run vivant. Le rapport précédent n'est pas relu pour les retrouver.
- **Ce que le rapport ne porte pas** : la clé API (ADR-012) et tout chemin de cache. C'est un livrable permanent, relu par l'app pour rouvrir le récapitulatif d'un run passé (sub-projects 04 et 07).

### Construction

`build_tagging_report(run: TaggingRun, thresholds, generated_at)` est une fonction pure sur l'instantané du run. Les lignes de tags passent par `tag_rows` et `after_rows`, bâties sur la projection et les clés de `files` (`project_tags`, `after_tags`, `shown_key`). `handlers.py` s'en sert pour `run_started` et `track_resolved` : la table de correspondance est la même partout.

Les scores sont ceux du plan de run (`PlanScores`, même forme). Un changement de ce modèle change donc aussi le rapport, ce qui exige d'en monter la version.

### Rendu Markdown

Le rendu se fait en anglais (ADR-014, `.claude/rules/python/fichiers-io.md`) :
- en-tête du run (identifiant, dossier, date, seuils) ;
- compteurs ;
- une table par issue : écrits, échecs d'écriture, non résolus, restaurés par rollback, non traités ;
- pour un morceau écrit : fichier avant et après, source, voie (`auto`, `arbitration`, `url`), score, nombre de champs écrits, pochette (`written`, `missing` quand la source en proposait une sans qu'elle ait été posée, `none` sinon), troncature du nom (ARCHITECTURE § Robustesse) et URL de la fiche source ;
- pour un échec d'écriture : fichier, source et motif. Pour un non résolu : fichier, requête et motif. Pour un restauré : le nom de fichier d'origine seul ;
- une note WAV dès qu'un fichier `.wav` est écrit (ADR-011).

Une section vide est omise et chaque valeur est échappée par les helpers de `reports.py`. Le Markdown n'est pas versionné : c'est un rendu du JSON (ADR-018).

### Écriture

Les fichiers sont `tagging-report-<horodatage>.json` et `.md` dans le dossier du run, via les briques communes de `reports.py`.

- **Noms** : `report_paths` choisit le couple une fois (suffixe `-2` si le couple existe déjà). `handlers.py` le garde sur le `CurrentRun` même quand la première écriture échoue, de sorte qu'une relance réécrit le même couple et ne crée jamais un `-2`.
- **Fin de `commit_run`** : `handle_commit_run` écrit le rapport après `writer.write()`.
- **Fin de `retry_write`** : `handle_retry_write` réécrit les mêmes fichiers depuis l'instantané du run.
- **Atomicité** : chaque fichier passe par `run_files.write_atomically`, une coupure ne laisse jamais un JSON tronqué. L'`OSError` devient une `ReportWriteError`.
- **Registre** : chaque écriture réussie inscrit le rapport au registre.
- **Échec d'écriture du rapport** : il est loggué en ERROR (`run=`, `reason=report_write_failed`, `errno=`) sans exception ni trace, celle d'un `OSError` portant le chemin complet sous le profil Windows. Le registre loggue de la même façon son échec d'écriture. Les fichiers musicaux sont déjà écrits, la phase se termine normalement et le run ne perd rien. Si seul le Markdown échoue, le JSON reste sur le disque, un log WARNING le signale et la relance le réécrit sous le même nom.
- **I/O** : toute I/O passe par `asyncio.to_thread` (`.claude/rules/python/asyncio.md`).

### Relecture

`load_tagging_report(path)` valide le JSON. La migration d'un rapport plus ancien se posera dans un `@model_validator(mode="before")` de `TaggingReport`, point d'entrée unique de l'ADR-018 option B. Il n'existe pas tant que seule la version 1 existe : un validateur qui rend sa donnée telle quelle n'est ni exerçable ni testable.

Une version supérieure à la version courante, un JSON illisible ou un modèle invalide lèvent `TaggingReportUnreadableError` :
- code `tagging_report_unreadable`, params `file`, `found`, `expected` ;
- erreur dérivée de `TaggerError` (`.claude/rules/python/gestion-erreurs.md`) ;
- traduction FR et EN livrée ici, la garde `test_error_translations` l'exigeant dès que le code existe (`.claude/rules/ngx-translate/i18n.md`).

### Registre

Le registre est le fichier `app_data_dir() / "reports.json"`, modèle `ReportIndex` : `schema_version` 1 et des `IndexEntry` (`run_id`, `written_at`, `folder`, `report_path`).

- **`record_report(index, entry)`** ajoute l'entrée, ou remplace celle du même `run_id`. L'écriture est atomique.
- **`list_reports(index)`** rend les entrées du plus récent au plus ancien, en écartant celles dont le JSON n'existe plus (dossier déplacé, rapport supprimé).
- **Registre absent** : il se lit vide.
- **Registre corrompu ou d'une version inconnue** : il est loggué en ERROR et traité comme vide et la prochaine inscription repart de zéro. Les rapports restent dans leurs dossiers.
- **Registre qui ne se lit pas** (`OSError` autre qu'un fichier absent, par exemple un verrou) : le contenu n'est pas en cause, l'inscription est sautée avec un log WARNING et le fichier n'est pas réécrit, pour ne pas écraser un historique intact par une seule entrée.
- **Purge** : aucune, le registre suit des livrables permanents.

### Conventions

`.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/mypy/strict.md`, `.claude/rules/python/imports-modules.md`, `.claude/rules/ruff/lint-format.md`, `.claude/rules/rapidfuzz/matching.md` (scores consignés), `.claude/rules/techno-scraper/contrat.md` (source consignée). Tests selon `.claude/rules/pytest/tests.md`.

## Acceptance criteria

### Scénario 1 : rapport à la fin de l'écriture
**GIVEN** un run résolu sur « Dim Orbit » et confirmé par `commit_run`
**WHEN** la phase d'écriture se termine
**THEN** le dossier contient `tagging-report-<horodatage>.json` et `.md`
**AND** le JSON porte le morceau écrit avec sa requête, sa source, sa voie `auto`, ses scores, l'ancien et le nouveau nom, les champs écrits et l'URL de la fiche source
**AND** `reports.json` porte une entrée pour ce `run_id` qui pointe sur ce JSON

### Scénario 2 : relance de l'écriture
**GIVEN** un run dont un morceau a échoué à l'écriture, avec son rapport
**WHEN** `retry_write` l'écrit
**THEN** les mêmes deux fichiers sont réécrits, le morceau y passe de `write_error` à `written` et aucun fichier `-2` n'apparaît

### Scénario 3 : chaque issue a sa section
**GIVEN** un run qui compte un morceau écrit au nom tronqué, un échec d'écriture, un non résolu en `no_result`, un morceau restauré par rollback, un morceau jamais atteint et un morceau resté en arbitrage
**WHEN** le rapport est rendu en Markdown
**THEN** cinq sections portent chacune leurs morceaux : écrits, échecs d'écriture, non résolus, restaurés et non traités
**AND** les compteurs valent 1 écrit, 1 échec d'écriture, 1 non résolu, 1 restauré et 2 non traités

### Scénario 4 : relance après un rollback partiel
**GIVEN** un run écrit dont un morceau a été restauré par `rollback`
**WHEN** `retry_write` termine
**THEN** le rapport réécrit porte ce morceau en `rolled_back` avec son fichier d'origine, ses tags d'origine et leur système
**AND** sa source, ses scores, son URL et ses noms écrits sont nuls
**AND** `counts.rolled_back` vaut 1

### Scénario 5 : relecture
**GIVEN** un rapport écrit
**WHEN** on le relit
**THEN** le rapport relu est égal à celui écrit

### Scénario 6 : rapport d'une version future
**GIVEN** un rapport dont la `schema_version` vaut 2
**WHEN** on le relit
**THEN** `TaggingReportUnreadableError` est levée, code `tagging_report_unreadable`, ses `params` nommant la version trouvée et la version attendue

### Scénario 7 : rapport impossible à écrire
**GIVEN** un dossier où l'écriture du rapport échoue
**WHEN** la phase d'écriture se termine
**THEN** `run_finished` arrive normalement, les fichiers musicaux sont écrits et un log ERROR `reason=report_write_failed` est écrit sans le chemin du dossier
**AND** le registre n'est pas touché

### Scénario 8 : Markdown refusé après le JSON
**GIVEN** un dossier où le JSON du rapport s'écrit mais pas son Markdown
**WHEN** `commit_run` termine, puis que `retry_write` est relancé une fois le dossier réparé
**THEN** la relance réécrit le même couple de noms et le dossier ne contient qu'un JSON et qu'un Markdown

### Scénario 9 : registre
**GIVEN** un registre qui porte deux runs, dont le rapport du plus ancien a été supprimé
**WHEN** on liste les rapports
**THEN** seul le plus récent est rendu

### Scénario 10 : registre impossible à lire
**GIVEN** un registre que le système refuse de lire
**WHEN** un rapport est inscrit
**THEN** l'inscription est sautée avec un log WARNING et le fichier n'est pas réécrit

## Tests à écrire

### Unit
- `sidecar/tests/unit/test_tagging_report.py` :
  - un run écrit donne un rapport qui porte, par morceau :
    - la requête, la source, la voie, le motif et les scores bruts ;
    - les noms écrits, le fichier avant et après, `truncated` ;
    - les URL, le système et les tags avant et après, les champs écrits ;
  - un morceau restauré ne garde que son fichier d'origine, ses tags d'origine et leur système
  - un morceau aux tags illisibles n'a pas de système et ses tags après suivent l'extension
  - les compteurs se lisent sur `state`, un arbitrage laissé en attente comptant en `not_processed`
  - un rapport écrit puis relu est égal à lui-même
  - une version future, un JSON corrompu et un modèle invalide lèvent `TaggingReportUnreadableError` avec `found` et `expected`
  - le Markdown porte, dans la section de chaque issue, le morceau de cette issue
  - le Markdown omet une section vide, échappe une valeur qui contient `|` et porte la note WAV dès qu'un `.wav` est écrit
  - le Markdown signale la voie, la pochette posée ou manquante et la troncature d'un morceau écrit
  - une réécriture sous les mêmes noms ne crée aucun fichier de plus et un couple déjà pris donne un `-2`
  - un Markdown refusé après le JSON lève `ReportWriteError` et logue un WARNING
- `sidecar/tests/unit/test_report_index.py` :
  - une inscription ajoute l'entrée, une seconde du même `run_id` la remplace
  - la liste va du plus récent au plus ancien et écarte une entrée dont le JSON a disparu
  - un registre corrompu ou d'une version inconnue se lit vide et l'inscription suivante le réécrit
  - un registre que le système refuse de lire n'est pas réécrit
  - un échec d'écriture du registre est loggué avec son `errno` sans le chemin
- `sidecar/tests/unit/test_error_translations.py` : inchangé, il couvre `tagging_report_unreadable` d'office.

### Integration
- `sidecar/tests/integration/test_ndjson_write.py` :
  - `commit_run` laisse le rapport JSON et Markdown dans le dossier tagué et son entrée au registre (scénario 1)
  - ni la clé API ni le dossier de données de l'application n'apparaissent dans le JSON ni dans le Markdown
  - `retry_write` réécrit les mêmes fichiers et le premier rapport portait le morceau en `write_error` (scénario 2)
  - `retry_write` après un rollback partiel écrit le morceau en `rolled_back` (scénario 4)
  - un rapport impossible à écrire n'empêche pas `run_finished` et son log ne porte pas le chemin (scénario 7)
  - un Markdown refusé une fois ne crée aucun `-2` à la relance (scénario 8)

## Edge cases

- **Run confirmé avec des arbitrages en attente** : les morceaux restent intacts, ils comptent en `not_processed` et apparaissent dans leur section.
- **Morceau aux tags d'origine illisibles** : `tags_before` et `system` sont `None` et le système des lignes `tags_after` se déduit de l'extension, comme pour la colonne Après.
- **Couple de noms déjà pris dans le dossier** (deux runs dans la même seconde) : le suffixe `-2` est choisi au premier passage, puis gardé.
- **Registre écrit par deux sidecars** : impossible, l'instance unique l'exclut (ARCHITECTURE § Robustesse).
- **Dossier du run en lecture seule** : le rapport n'est pas écrit (log ERROR), le registre n'est pas touché et le run reste écrit.
- **JSON écrit sans son Markdown** : le JSON orphelin reste sur le disque jusqu'à la relance suivante, qui le réécrit. Sans relance, il reste sans entrée au registre.
- **Rapport réécrit après un rollback partiel** : le morceau restauré perd source, scores et URL, que le run vivant n'a plus. Le rapport écrit après `commit_run` reste la trace de ce qui a été écrit et il est réécrit par la relance.

## Architectural decisions

### Décision : moment d'écriture du rapport
**Options envisagées :**
- **A. Fin de `commit_run` et de chaque `retry_write`, mêmes fichiers** : le rapport suit les relances et le rollback ne le touche pas.
- **B. Aussi après un rollback** : le rapport marque les morceaux restaurés, mais il faut le fusionner avec celui du disque, le rollback ayant effacé source et score du `TrackRecord`.
- **C. Une seule fois, à la fin de `commit_run`** : une relance réussie n'y apparaît jamais.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le rapport dit ce qui a été écrit. La restauration a sa propre trace, le dump.

### Décision : morceau restauré avant une relance
**Options envisagées :**
- **A. Le rapport réécrit rapporte le morceau en `rolled_back`, sans décision** : un compteur `rolled_back` et une section « Rolled back », sans relire le rapport précédent.
- **B. Garder l'entrée du rapport précédent** : source, scores et URL survivent, mais il faut relire et fusionner un fichier qui peut avoir disparu ou être illisible.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le rapport décrit l'état du run au moment de l'écriture, sans dépendre d'un fichier antérieur.

### Décision : scores consignés
**Options envisagées :**
- **A. Candidat retenu seul** : scores déjà dans le `TrackRecord`, aucun changement au pipeline.
- **B. Tous les candidats évalués** : le pipeline doit garder les listes qu'il jette à la résolution.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le score du retenu, la voie (auto ou arbitrage) et le motif d'un rejet suffisent à recalibrer les deux seuils (ADR-008).

### Décision : registre des rapports
**Options envisagées :**
- **A. Un index `reports.json`** : une lecture rend toute la liste.
- **B. Un pointeur par run sous `appLocalDataDir()/reports/`** : sur le patron des dumps et plans, mais la liste exige d'ouvrir chaque fichier.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- La liste des runs passés est lue en entier à chaque ouverture : un seul fichier suffit.

### Décision : lecture d'un registre défaillant
**Options envisagées :**
- **A. Repartir de zéro seulement quand le contenu est en cause** (JSON invalide, modèle invalide, version inconnue) : une erreur de lecture du système saute l'inscription sans réécrire.
- **B. Repartir de zéro dès qu'il ne se lit pas** : plus simple, mais un verrou passager (antivirus) ferait perdre tout l'historique.

**Choix : A**

**Rationale :**
- Choix du propriétaire, le 2026-10-12.
- Le registre suit des livrables permanents : l'écraser sur une erreur passagère détruit des entrées que les rapports eux-mêmes ne permettent pas de reconstituer.
