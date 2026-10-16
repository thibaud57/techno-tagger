---
feature: "Feature 9 : Monitoring"
subproject: "issue-de-retour-sidecar"
goal: "Construire, depuis le rapport de re-tagging d'un run, l'URL d'une issue GitHub pré-remplie par l'Issue Form du dépôt et un export JSON nettoyé à y joindre, sans chemin absolu ni donnée hors liste fermée."
status: "draft"
complexity: "L"
tdd_scope: "full"
depends_on: []
date: "2026-10-16"
---

# Issue de retour de matching, côté sidecar

## Scope

Le sidecar construit, à partir d'un `TaggingReport`, l'URL `issues/new` qui ouvre l'Issue Form `matching-report.yml` du dépôt, pré-remplie d'un titre, de la version et d'un résumé du run borné à 2048 caractères. Il écrit en parallèle un export JSON nettoyé dans `app_data_dir()/feedback/`, que l'utilisateur glisse dans l'issue pour partager tout le run. L'Issue Form, qui pose le label `matching-report`, fait partie du sub-project.

Exclus : la commande et l'événement NDJSON qui exposent l'URL et le chemin de l'export (`03-protocole-ndjson-retour`), le bouton de l'écran récapitulatif et l'ouverture du navigateur et de l'Explorateur (`04-bouton-envoyer-rapport-ui`), la vérification sur github.com du formulaire et du label appliqué à un auteur non collaborateur (`05-recette-monitoring`, possible seulement une fois le formulaire sur la branche par défaut).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir, sur un rapport de 500 morceaux, une URL de moins de 2048 caractères qui cible `template=matching-report.yml` sans paramètre `labels`, liste d'abord les non résolus et finit par le nombre exact de morceaux omis et un export écrit dans `feedback/` qui ne contient ni le dossier du run ni aucun commentaire d'origine.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À créer** : `sidecar/src/tagger/reports/feedback.py` (URL de l'issue, résumé borné, modèles de l'export, écriture et purge de l'export)
- **À créer** : `.github/ISSUE_TEMPLATE/matching-report.yml` (Issue Form, label `matching-report`, champs `version`, `summary`, `export`, `notes`)
- **À créer** : `sidecar/tests/unit/reports/test_feedback.py`
- **À modifier** : `sidecar/src/tagger/__init__.py` (`REPOSITORY_URL`, ajouté à `__all__`)
- **À modifier** : `sidecar/src/tagger/reports/tagging.py` (`_score` devient `format_score`, partagé avec le résumé de l'issue)
- **À modifier** : `sidecar/src/tagger/__main__.py` (purge des exports au démarrage, à côté de celles des dumps et des plans)
- **À modifier** : `sidecar/tests/unit/test_main.py` (`REPOSITORY_URL` égal au `repository` de `src-tauri/Cargo.toml`, purge des exports au démarrage)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (`errors.feedback_export_write_failed` : `test_error_translations.py` importe tous les modules du sidecar et exige une phrase pour chaque code de `TaggerError` dès qu'il existe)
- **À modifier** : `sidecar/tests/helpers/tagging_report_samples.py` (fabriques `report_track` et `report_of` d'un morceau et d'un rapport de N morceaux, constantes `COMMENT` et `HOME_FOLDER` ; `RUN`, `BEFORE` et `FOLDER` restent, `BEFORE` lit `COMMENT`)
- **À modifier** : `docs/adrs/014-observabilite-sentry-et-rgpd.md` (mise à jour datée : Issue Form, budget d'URL, export nettoyé)
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence et table des modules de `reports/`, § Observabilité > Alerts : forme de l'envoi)
- **À modifier** : `docs/PRODUCTION.md` (§ Observabilité : canal d'amélioration du matching, label `matching-report` à créer dans le dépôt)

## Architecture approach

- **Le métier reste dans le sidecar** (`.claude/CLAUDE.md` § Standards) : choix des morceaux, ordre, budget de l'URL et contenu de l'export sont des règles du projet. La webview recevra une URL et un chemin, elle n'assemble rien
- **Issue Form plutôt que `body=`** : un paramètre `labels` dans l'URL exige le droit de poser un label, sans lequel GitHub rend une 404 (doc « Creating an issue from a URL query », lue le 2026-10-16). Le label vient donc de `labels: [matching-report]` du formulaire et l'URL pré-remplit ses champs par leur `id`. Le label ne vit que dans le formulaire : le sidecar ne le connaît pas
- **URL bornée à `MAX_URL_LENGTH = 2048`** : `tauri-plugin-opener` ouvre l'URL par la crate `open` 5 (feature `shellexecute-on-windows`), qui appelle `ShellExecuteExW` (chaîne vérifiée le 2026-10-16). Cette API est soumise à `INTERNET_MAX_URL_LENGTH`, qui vaut 2083 dans `WinINET.h` (blog IEInternals, Microsoft, « URL Length Limits »), et Raymond Chen écrit « around 2048 » (The Old New Thing, 2003-12-10, « What is the command line length limit? »). On garde 2048, la valeur ronde sous les deux. GitHub rend 414 à partir de 8192 octets (mesure publiée dans ALCops/rulebook-engine#40, date non confirmée) : c'est Windows qui borne. Le budget porte sur l'URL entière, encodée. La constante cite ces sources dans son commentaire
- **Encodage `application/x-www-form-urlencoded`** (`urllib.parse.urlencode`, espaces en `+`) : un caractère sur trois du résumé est une espace, la forme la plus courte. La longueur encodée d'une concaténation étant la somme des longueurs encodées, chaque ligne du tableau s'encode une seule fois et le remplissage s'arrête à la première ligne qui dépasse : un seul passage, ordre de priorité respecté
- **Contenu du résumé, en anglais** (ADR-014, rapports en anglais) : une ligne de compteurs (`written`, `write errors`, `unresolved`, `rolled back`, `not processed`) et de seuils, puis une table `File | Query | Route | Score | Match`. `File` est le nom du fichier sans ses sous-dossiers, `Query` le texte de la requête suivi de son origine (`tags` ou `filename`), `Route` la voie de résolution ou le motif d'échec, `Score` le rendu de `format_score` (« 94 (A 96 · T 92) »), `Match` l'artiste et le titre du candidat retenu. Les cellules passent par `table_row` et `escape_markdown` de `reports/extraction.py`. Les cellules libres (`File`, `Query`, `Match`) sont rendues en code spans Markdown, après remplacement d'un éventuel backtick interne par une apostrophe : l'issue est publique et un nom de fichier ou un titre contenant `@pseudo` ou `#12` y notifierait un tiers ou créerait une référence croisée, ce qu'un code span neutralise. Si le budget coupe, une dernière ligne `_N more tracks in the attached export._` donne le compte exact
- **Ordre des lignes** : non résolus, puis rattrapés par lien (`Resolution.URL`), arbitrés (`Resolution.ARBITRATION`), erreurs d'écriture et enfin les validés automatiquement par score croissant. C'est l'écart entre un nom de fichier, sa requête et le candidat qui fait progresser le matching (ADR-014) : un morceau validé haut la main n'apprend presque rien. Les morceaux restaurés par rollback et les non traités n'ont plus de décision : ils sont comptés, jamais listés
- **Titre** : `Matching report: <written> written, <unresolved> unresolved (<release>)`, la release portant le préfixe `techno-tagger@`
- **Champs pré-remplis** : `version` reçoit la release, `summary` le résumé, `export` la consigne `Drop <nom de l'export> here`. `notes` reste vide, pour l'utilisateur. Le formulaire ouvre sur un texte qui rappelle que l'issue est publique et se relit avant validation
- **Export nettoyé par liste fermée** (`.claude/rules/pydantic/modeles.md`) : `FeedbackExport` et `FeedbackTrack` sont des modèles dédiés, `frozen` et `extra="forbid"`, construits champ par champ depuis le rapport. Un champ ajouté plus tard à `TaggingReport` n'entre pas dans l'export sans décision. Sont repris : `kind` (constante `matching-feedback`), `release`, `generated_at`, `thresholds`, `counts` et, par morceau, `file_before` et `file_after` réduits au nom du fichier, `query`, `source`, `state`, `resolution`, `failure_reason`, `scores`, `artist`, `title`, `url`, `tags_before`, `tags_after`, `fields_written`, `artwork_written`, `truncated`. `tags_before` et `tags_after` partent tels quels dans l'export : ce sont les champs de la table de correspondance de `tags/files.py` (artiste, titre, label, BPM, ISRC, `URL` et `SOURCE_ID` compris), des métadonnées de catalogue et `comment_before` est le seul texte libre exclu (décidé le 2026-10-16). Sont écartés : `folder` (chemin absolu, nom du compte de l'OS), `comment_before` (texte libre de l'utilisateur), les sous-dossiers des noms de fichiers, `artwork_url`, `track_id` (chemin relatif, doublon de `file_before` avec ses sous-dossiers). Le `run_id` n'apparaît que dans le nom de l'export
- **Écriture de l'export** (`.claude/rules/python/fichiers-io.md`) : JSON indenté, `ensure_ascii=False` pour qu'il se relise, écrit par `write_atomically` de `core/run_files.py` dans `app_data_dir()/feedback/` sous `stamped_name(report.generated_at, report.run_id, ".json")`. Le même run donne toujours le même nom : un nouveau clic réécrit le fichier au lieu d'en ajouter un. Le nom porte la date du run, non celle de l'écriture (cf. Edge cases). Une `OSError` devient `FeedbackExportWriteError`, qui nomme le fichier en `params`
- **Purge au démarrage** : `purge_feedback_exports(folder, now)` délègue à `purge_stamped` (rétention `RETENTION`, 30 jours) avec les suffixes `.json` et `.tmp`, appelée dans `main()` sous la même garde que les dumps et les plans : une purge ratée ne bloque jamais le démarrage
- **Une valeur, une source** (`.claude/CLAUDE.md` § Standards) : `REPOSITORY_URL` est recopiée de `src-tauri/Cargo.toml`, qu'aucun code du sidecar ne lit et gardée par un test de cohérence dans `test_main.py`, comme `APP_NAME` et `BUNDLE_IDENTIFIER`. Le nom du formulaire et les `id` de ses champs sont des constantes de `feedback.py`, gardées par un test qui relit `.github/ISSUE_TEMPLATE/matching-report.yml`
- **Création du label** : `matching-report` doit exister dans le dépôt pour que le formulaire le pose. Sa création par `gh label create` est une action sur le dépôt public, faite à l'implémentation après confirmation du propriétaire
- **Rules** : `.claude/rules/python/fichiers-io.md`, `.claude/rules/python/stdlib-donnees.md`, `.claude/rules/python/modeles-donnees.md`, `.claude/rules/python/type-hints.md`, `.claude/rules/python/gestion-erreurs.md`, `.claude/rules/pydantic/modeles.md`, `.claude/rules/pytest/tests.md`

## Acceptance criteria

### Scénario 1 : run ordinaire
**GIVEN** le rapport d'un run de quelques morceaux, dont un non résolu, un rattrapé par lien, un arbitré et des validés automatiquement
**WHEN** le sidecar construit l'URL de l'issue
**THEN** l'URL commence par `<REPOSITORY_URL>/issues/new?template=matching-report.yml` et ne porte aucun paramètre `labels`
**AND** le résumé liste le non résolu, puis le rattrapé, puis l'arbitré, puis les validés par score croissant, sans ligne « more »
**AND** le titre porte les compteurs et la release

### Scénario 2 : gros run
**GIVEN** le rapport d'un run de 500 morceaux
**WHEN** le sidecar construit l'URL de l'issue
**THEN** l'URL encodée fait au plus 2048 caractères
**AND** le résumé finit par `_N more tracks in the attached export._`, `N` étant exactement le nombre de morceaux listables omis

### Scénario 3 : rien de personnel hors liste fermée
**GIVEN** un rapport dont le dossier est un chemin absolu sous le profil de l'utilisateur et dont un morceau porte un commentaire d'origine et un sous-dossier
**WHEN** le sidecar construit l'URL et écrit l'export
**THEN** ni l'URL ni l'export ne contiennent le dossier du run, le commentaire ni le sous-dossier
**AND** l'export porte la release et le nom de chaque fichier

### Scénario 4 : nouveau clic sur le même run
**GIVEN** un export déjà écrit pour un run
**WHEN** le sidecar écrit à nouveau l'export de ce run
**THEN** `feedback/` ne contient qu'un fichier pour ce run, réécrit

### Scénario 5 : export ancien au démarrage
**GIVEN** dans `feedback/` un export dont le run date de plus de 30 jours (la date de son nom) et un export dont le run date de moins de 30 jours
**WHEN** le sidecar démarre
**THEN** le premier est supprimé
**AND** le second est conservé

## Tests à écrire

### Unit

- `sidecar/tests/unit/reports/test_feedback.py` :
  - l'URL cible l'Issue Form du dépôt et ne porte jamais de paramètre `labels`
  - le titre porte les compteurs `written` et `unresolved` et la release
  - les lignes suivent l'ordre non résolus, lien, arbitrage, erreurs d'écriture, puis validés par score croissant
  - un morceau restauré ou non traité est compté, jamais listé
  - une cellule qui contient `|` ou un retour à la ligne ne casse pas la table
  - un nom de fichier `@jane #12` et un titre contenant un backtick sont rendus en code spans : ni mention ni référence, aucun backtick interne
  - un run de 500 morceaux tient dans 2048 caractères, nomme exactement le nombre de morceaux omis et ne s'arrête pas plus de la hauteur d'une ligne avant la borne
  - la ligne « more » compte dans le budget : quelle que soit la longueur des lignes, l'URL reste sous 2048 caractères
  - un run qui tient entier n'a pas de ligne « more »
  - un titre non ASCII est compté à sa longueur encodée
  - le champ `export` nomme le fichier de l'export
  - le dossier du run (chemin absolu), un sous-dossier et un commentaire d'origine n'apparaissent ni dans l'URL ni dans l'export
  - l'export ne porte que les champs de la liste fermée (`kind` et `release` compris)
  - un second export du même run réécrit le même fichier
  - un échec d'écriture lève `FeedbackExportWriteError` qui nomme le fichier
  - la purge supprime un export dont le run passe la rétention et garde un export dont le run est récent
  - l'Issue Form déclare chaque `id` que l'URL remplit
- `sidecar/tests/unit/test_main.py` :
  - `REPOSITORY_URL` égale le `repository` de `src-tauri/Cargo.toml`
  - le démarrage purge les exports dont le run passe la rétention

## Edge cases

- **Rapport sans morceau listable** (tout restauré, ou run vide) : le résumé garde la ligne de compteurs, sans table
- **Ligne trop longue pour le budget restant** : le remplissage s'arrête là, elle et les suivantes sont comptées dans `N`, l'ordre de priorité n'est jamais inversé pour caser une ligne plus courte
- **Caractères non ASCII** (accents, alphabets non latins) : comptés à leur longueur percent-encodée, jusqu'à douze caractères pour un caractère hors du plan multilingue de base (quatre octets UTF-8), neuf pour un caractère du plan sur trois octets
- **Export d'un run de plus de 30 jours** (décidé le 2026-10-16) : le nom porte la date du run (`report.generated_at`), non celle de l'écriture. L'export d'un run ancien, rouvert puis envoyé, est donc purgé au prochain démarrage du sidecar. Accepté : l'export ne sert qu'au moment du glisser-déposer, juste après le clic
- **Rapport d'un schéma antérieur** : il arrive déjà migré par `load_tagging_report`, le builder ne voit qu'un `TaggingReport` courant
- **Formulaire absent de la branche par défaut** (avant la release qui le livre) : GitHub n'applique ni le formulaire ni son label. Constaté et traité à la recette, `05-recette-monitoring`
- **Label absent du dépôt** : le formulaire ne le pose pas, sans erreur (doc « Syntax for issue forms », lue le 2026-10-16). D'où sa création à l'implémentation

## Architectural decisions

### Décision : forme de l'envoi

**Options envisagées :**
- **A. Issue Form, résumé borné dans l'URL et export nettoyé à joindre** : label posé par le formulaire, tout le run partageable par glisser-déposer, relu par l'utilisateur
- **B. Issue Form et résumé seul** : plus simple, mais un gros run ne partage que ses morceaux prioritaires
- **C. `body=` sans formulaire** : aucun label possible pour un non-collaborateur, tri des retours à la main

**Choix : A** (décidé par le propriétaire le 2026-10-16)

**Rationale :**
- La limite de 2048 caractères interdit de faire passer le rapport par l'URL, l'export la contourne sans endpoint à héberger
- L'application ne pousse toujours rien elle-même : l'utilisateur ouvre, relit, glisse ou non le fichier, valide

### Décision : contenu de l'export

**Options envisagées :**
- **A. Modèles dédiés, liste fermée de champs** : un champ ajouté au rapport n'en sort pas sans décision
- **B. Le rapport privé de quelques champs (`exclude`)** : moins de code, mais tout champ ajouté plus tard part d'office

**Choix : A**

**Rationale :**
- Même principe que les messages d'exception de `01-payloads-sans-titre` : par défaut, rien ne part
- L'export n'est jamais relu par l'application : ses modèles n'ont aucune migration à porter

### Décision : nom de l'export

**Options envisagées :**
- **A. `<generated_at>-<run_id>.json` par `stamped_name`** : purge par `purge_stamped`, même rétention que les dumps et les plans
- **B. `techno-tagger-<run_id>.json`** : plus parlant une fois joint à l'issue, mais demande une seconde mécanique de rétention, sur la date de modification

**Choix : A** (validé par le propriétaire le 2026-10-16)

**Rationale :**
- Une seule mécanique de rétention dans `appLocalDataDir()`
- Contrepartie acceptée le 2026-10-16 : la rétention suit la date du run, donc l'export d'un run de plus de 30 jours disparaît au démarrage suivant
- Le formulaire dit déjà de quoi il s'agit, le nom du fichier n'a pas à le redire
