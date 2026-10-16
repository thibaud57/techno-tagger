---
feature: "Feature 9 : Monitoring"
subproject: "recette-monitoring"
goal: "Vérifier sur l'application installée depuis une Release publiée que Sentry reçoit des deux côtés des événements sans rien de personnel et que l'issue de retour arrive labellisée, grâce à un self-test déclenché au lancement."
status: "draft"
complexity: "M"
tdd_scope: "partial"
depends_on: ["01-payloads-sans-titre-design.md", "02-issue-de-retour-sidecar-design.md", "03-protocole-ndjson-retour-design.md", "04-bouton-envoyer-rapport-ui-design.md"]
date: "2026-10-16"
---

# Recette du monitoring

## Scope

Deux temps. D'abord un déclencheur de test livré avec la feature : lancée avec `TECHNO_TAGGER_SENTRY_SELFTEST=1`, l'application envoie un seul événement Sentry par côté, sidecar et webview, porteur de fausses données sensibles que le masquage doit effacer. Ensuite la recette, sur l'application installée depuis la Release publiée qui livre la Feature 9 : releases Sentry et source maps, chaîne d'alerte, payload inspecté, issue de retour envoyée depuis un compte non collaborateur, puis les cases de PRODUCTION.md cochées et datées.

Exclus : la distribution et l'updater (`04-recette-distribution` de la Feature 8), tout correctif applicatif trouvé à la recette, qui part en `hotfix/*` (PRODUCTION.md § Rollback), le scrubbing côté serveur Sentry.

### État livré

À la fin de ce sub-project, on peut : lancer l'application installée depuis PowerShell avec `TECHNO_TAGGER_SENTRY_SELFTEST=1`, voir arriver un événement dans `techno-tagger-sidecar` et un dans `techno-tagger-ui` avec leur email d'alerte, sans variable de frame, nom de machine, chemin ni titre, puis voir une issue envoyée depuis le récapitulatif par un compte non collaborateur porter le label `matching-report` ; les cases correspondantes de PRODUCTION.md sont cochées avec leur date.

## Dependencies

- `01-payloads-sans-titre-design.md` (statut: draft) : `data_collection` fermé, liste fermée des messages, motif de chemin, ce que le payload inspecté doit montrer
- `02-issue-de-retour-sidecar-design.md` (statut: draft) : Issue Form, label, URL bornée et export, ce que l'issue de recette exerce
- `03-protocole-ndjson-retour-design.md` (statut: draft) : `prepare_feedback` et `feedback_ready` seulement : le champ `version` n'est pas touché par 03, c'est ce sub-project qui l'étend
- `04-bouton-envoyer-rapport-ui-design.md` (statut: draft) : le bouton qui ouvre l'issue

## Files touched

- **À modifier** : `sidecar/src/tagger/core/observability.py` (`SELFTEST_ENV`, `selftest_requested()`, `SentrySelfTestError`, `send_selftest()`)
- **À modifier** : `sidecar/src/tagger/__main__.py` (`send_selftest()` après `init_sentry`, quand la variable est posée)
- **À modifier** : `sidecar/src/tagger/protocol.py` (`Version.sentry_selftest`)
- **À modifier** : `sidecar/src/tagger/handlers.py` (`handle_get_version` remplit `sentry_selftest`)
- **À modifier** : `sidecar/tests/unit/core/test_sentry_payload.py` (l'enveloppe du self-test, passée par le vrai SDK : un seul événement `SentrySelfTestError`, de valeur exactement `<message>`, sans chemin ni titre ni variable de frame)
- **À modifier** : `sidecar/tests/unit/test_main.py` (fixture autouse qui efface la variable ; self-test envoyé au démarrage avec la variable, jamais sans)
- **À modifier** : `sidecar/tests/unit/test_protocol_models.py` (littéral `Version`)
- **À modifier** : `sidecar/tests/integration/test_ndjson_settings.py` (`get_version` porte `sentry_selftest`)
- **À modifier** : `src/app/core/sidecar/protocol.ts` (`VersionEvent.sentry_selftest`)
- **À modifier** : `src/app/core/sidecar/sidecar.service.ts` (signal `sentrySelftest` posé depuis `version`)
- **À modifier** : `src/app/core/sidecar/sidecar.service.spec.ts` (helper des littéraux `version`)
- **À modifier** : `src/fixtures/sidecar-stub.ts` (`sentrySelftest`)
- **À créer** : `src/app/core/observability/sentry-selftest.service.ts` (un seul `captureException` par lancement quand `sentrySelftest` vaut vrai)
- **À créer** : `src/app/core/observability/sentry-selftest.service.spec.ts`
- **À modifier** : `src/app/app.config.ts` (service construit au démarrage, comme `CompletionSignalService`)
- **À modifier** : `docs/PRODUCTION.md` :
  - § Variables d'Environnement : `TECHNO_TAGGER_SENTRY_SELFTEST`, seule variable de configuration lue à l'exécution, réservée au diagnostic ; la phrase « aucune variable d'environnement » (l.237 au 2026-10-16) et sa reprise (l.739) sont corrigées en conséquence ;
  - § Observabilité : procédure du self-test, rejouable à chaque release à condition de résoudre d'abord l'issue Sentry du rejeu précédent ;
  - Checklist Post-MEP : nouvel item « Issue de retour vérifiée en réel », items Sentry cochés et datés ;
  - Checklist Pré-MEP > Bootstrap technique : « Releases Sentry créées dans les deux projets » et « Source maps de la webview uploadées puis purgées » cochés et datés ;
  - Checklist Pré-MEP : « Durcissement Sentry en place et testé » coché et daté ;
  - Validation technique finale : « Test de sécurité vert » ne se coche que si les parties logs, rapports et clé API sont aussi prouvées, pas sur la seule partie Sentry.
- **À modifier** : `docs/ARCHITECTURE.md` (§ API : champ `sentry_selftest` de `version` ; § Ordre de développement : étape 8 livrée)
- **À modifier** : `.claude/rules/sentry/python.md` (puce « Provoquer une exception de test depuis le binaire empaqueté » : par `TECHNO_TAGGER_SENTRY_SELFTEST`), via `Skill[rules-doc]`
- **À modifier** : `docs/knowledges/sentry.md` (l.171 et l.239, relevées le 2026-10-16 : les puces « Vérifier la remontée depuis le binaire empaqueté » et « Provoquer une erreur de test depuis le binaire empaqueté » renvoient au self-test), via `Skill[knowledge-doc]`
- **Non modifiés** : les scripts `.claude/skills/verify/scripts/page/*.js` (`settings-audit.js`, `settings-admin-layout.js`, `settings-matching-layout.js`) fabriquent des événements `version` sans `sentry_selftest`. C'est inoffensif (valeur absente, donc fausse côté interface) et `/verify` les complétera à sa prochaine exécution

## Architecture approach

### Déclencheur

- **Variable lue à l'exécution, pas au build** : le DSN (`.env`, gravé par `build.py` et `--define`) dit où envoyer, il ne fait partir aucun événement. Le self-test fait partir un événement maintenant, depuis l'application installée, que rien d'autre ne permet de faire échouer à la demande : aucune devtools dans un build de release (`tauri.conf.json`, `Cargo.toml` sans feature `devtools`). La variable n'entre pas dans `.env.example`, réservé aux secrets de build
- **Héritée par le sidecar** : `Command.sidecar()` lance le sidecar avec l'environnement de l'application, elle-même lancée depuis PowerShell avec la variable (même mécanisme que celui que la rule keyring décrit pour `PYTHON_KEYRING_BACKEND`)
- **Valeur exacte `1`** : toute autre valeur, absente comprise, n'envoie rien. Lue à chaque appel de `selftest_requested()` (par `main()` au démarrage puis par chaque `get_version`) par `os.getenv(SELFTEST_ENV, "") == "1"` (`.claude/rules/python/fichiers-io.md` : `os.getenv` avec défaut)
- **Côté sidecar** : `send_selftest()`, appelé dans `main()` juste après `init_sentry`, lève puis remonte par `capture_unexpected` une `SentrySelfTestError`. C'est une `Exception` simple, pas une `TaggerError` : elle n'atteint jamais l'interface et n'a pas de phrase à traduire (`test_error_translations.py` exige une traduction pour chaque `TaggerError`). Son message porte un faux chemin de morceau (`D:\Musique\Nova Pulse - Your Mind.mp3`) que le paramètre `path` de la frame qui lève porte aussi : c'est la variable locale sensible, aucune autre n'est nécessaire. Sur le vrai pipeline, le message doit arriver en `<message>` (hors liste fermée) et la frame sans variable. DSN vide : rien ne part, comme toute remontée
- **`version.sentry_selftest`** : vrai quand la variable est posée. Seul le sidecar lit son environnement : le champ rejoint ceux que `version` porte déjà pour la même raison (`api_key_configured`, `default_thresholds`, `log_file`)
- **Côté webview** : `SentrySelftestService` (`@Service()`), construit au démarrage par un `provideAppInitializer` comme `CompletionSignalService`, observe `sentrySelftest()` et appelle `Sentry.captureException(new Error(...))` une seule fois par lancement, avec le même faux chemin, qui doit arriver en `<path>` (la webview garde ses messages, son masquage porte sur les chemins). `version` revient après `set_api_key` et après une relance du moteur : un drapeau local empêche un second envoi

### Recette

Sur l'application installée depuis la Release publiée qui livre les sub-projects 01 à 05, sur une machine Windows sans toolchain. Chaque action sur GitHub ou Sentry, création ou suppression, se fait après confirmation du propriétaire.

- **Releases Sentry** : dans l'organisation `tg-ws`, page Releases de `techno-tagger-sidecar` et de `techno-tagger-ui`, la version de la Release existe avec l'onglet Commits renseigné (job `sentry-release`)
- **Source maps** : la preuve vient du log du job de build (script npm `sourcemaps` : upload par `sentry-cli`, puis suppression des `.map` ; le log énumère les `.map` envoyés et n'en montre plus après la purge) et de la pile de l'événement webview du self-test, lisible en TypeScript (Debug IDs). Aucun contrôle sur l'installeur ni sur le dossier installé : `tauri-codegen` embarque `frontendDist` dans le binaire (PRODUCTION.md l.316), un `.map` oublié n'y serait pas un fichier et la recherche rendrait toujours vide
- **Self-test** : les issues de self-test d'un rejeu précédent sont d'abord résolues (même groupe : sans nouvelle issue, aucun email ne part). Application fermée, puis lancée depuis PowerShell avec `TECHNO_TAGGER_SENTRY_SELFTEST=1`, la variable retirée de la session ensuite. Un événement par projet et l'email d'alerte pour chacun, reçu à l'adresse d'alerte du propriétaire
- **Règle d'alerte** : à la première recette, vérifier dans Sentry que la règle d'alerte de chaque projet couvre une exception capturée par `capture_unexpected` (gérée au sens du SDK), PRODUCTION.md § Alertes parlant d'« exception non gérée ». Si elle ne la couvre pas, le self-test ne prouve pas la chaîne d'alerte des crashs : la règle ou PRODUCTION.md se corrige et la case « Chaîne d'alerte Sentry » reste ouverte jusque-là
- **Payload inspecté dans l'interface Sentry** (organisation `tg-ws`), sur chacun des deux événements : Issues du projet, issue `SentrySelfTestError` (sidecar) ou issue `Error` du self-test (webview), ouvrir l'événement, vue JSON (lien en tête de l'événement), puis rechercher dans le JSON `Nova`, `Mind`, le nom de compte Windows, le nom de la machine et `vars` :
  - `release` identique des deux côtés, préfixe `techno-tagger@` compris ;
  - `environment: production` des deux côtés ;
  - `server_name` égal au nom de l'application sur l'événement du sidecar seulement : le SDK navigateur ne le pose jamais (aucun `serverName` dans `sentry-options.ts`, `server_name` écrit par le seul client serveur de `@sentry/core` 11.6.0, relevé le 2026-10-16), son absence sur l'événement webview est le résultat attendu ;
  - aucune variable de frame ;
  - aucun nom de compte, aucun chemin, aucun fragment de « Nova Pulse » ni de « Your Mind » ;
  - message du sidecar en `<message>`, chemin de la webview en `<path>`
- **Issue de retour en réel**, sur un run réel écrit depuis l'application installée, dans un dossier de travail dédié qui contient quelques morceaux de catalogue public, jamais la bibliothèque personnelle : l'issue reste publique le temps de la recette et porte les noms de fichiers du run :
  - le formulaire `matching-report.yml` s'ouvre, version, résumé et consigne d'export pré-remplis, résumé entier ou terminé par la ligne « more », jamais coupé au milieu ;
  - l'Explorateur s'ouvre sur l'export, qui se glisse dans le champ `export` ;
  - l'issue est envoyée depuis un compte non collaborateur du dépôt (un utilisateur réel ou un second compte) : le label `matching-report` y est posé ;
  - l'issue de test est supprimée ensuite : elle porte de vrais titres et ne doit rester publique que si le propriétaire le décide
- **Label absent** au début de la recette (étape de `02-issue-de-retour-sidecar` non faite) : créé par `gh label create` avant l'envoi
- **Cases cochées** au fil de la recette, chacune datée, aucune sur une preuve indirecte (règle « Écrire durable » des instructions utilisateur)

### Rules applicables

`.claude/rules/sentry/python.md`, `.claude/rules/sentry/angular.md`, `.claude/rules/python/fichiers-io.md`, `.claude/rules/python/gestion-erreurs.md`, `.claude/rules/pydantic/modeles.md`, `.claude/rules/pytest/tests.md`, `.claude/rules/typescript/types.md`, `.claude/rules/angular/services.md`, `.claude/rules/angular/signals.md`, `.claude/rules/angular/app-config.md`, `.claude/rules/angular/tests.md`

## Acceptance criteria

### Scénario 1 : self-test du sidecar
**GIVEN** le sidecar lancé avec `TECHNO_TAGGER_SENTRY_SELFTEST=1` et un DSN réel
**WHEN** il démarre
**THEN** un seul événement part, de type `SentrySelfTestError`
**AND** son message vaut exactement `<message>`, sa frame ne porte aucune variable

### Scénario 2 : self-test de la webview
**GIVEN** `version.sentry_selftest` vrai
**WHEN** la webview reçoit `version`, puis à nouveau après `set_api_key`
**THEN** un seul événement part, dont le message porte `<path>` à la place du faux chemin

### Scénario 3 : lancement ordinaire
**GIVEN** la variable absente, ou de valeur autre que `1`
**WHEN** l'application démarre
**THEN** aucun événement de test ne part, `version.sentry_selftest` vaut faux

### Scénario 4 : recette Sentry
**GIVEN** l'application installée depuis la Release, lancée avec la variable
**WHEN** les deux événements arrivent
**THEN** chacun déclenche son email et son payload ne montre ni variable, ni nom de machine, ni chemin, ni titre
**AND** la release de chaque événement existe côté Sentry avec ses commits

### Scénario 5 : recette de l'issue
**GIVEN** un run réel écrit depuis l'application installée, sur un dossier de travail dédié de morceaux de catalogue public (jamais la bibliothèque personnelle, l'issue étant publique le temps de la recette)
**WHEN** un compte non collaborateur envoie l'issue ouverte par « Envoyer ce rapport », export glissé
**THEN** l'issue porte le label `matching-report`, la version, le résumé et le fichier joint

## Tests à écrire

### Unit

- `sidecar/tests/unit/core/test_sentry_payload.py` :
  - l'enveloppe du self-test, passée par le vrai SDK et `_scrub`, porte un seul événement de type `SentrySelfTestError` dont la valeur vaut exactement `<message>`, aucun fragment du faux chemin ni du faux titre (contexte source des frames compris) et aucune variable de frame
- `sidecar/tests/unit/test_main.py` :
  - le démarrage envoie le self-test après `init_sentry` quand la variable vaut `1`
  - il n'envoie rien quand elle est absente ou vaut autre chose (cas paramétrés avec `ids`)
- `sidecar/tests/unit/test_protocol_models.py` :
  - littéral `Version` complété (test existant)
- `src/app/core/observability/sentry-selftest.service.spec.ts` :
  - un `version` à `sentry_selftest` vrai provoque un seul `captureException`, même reçu deux fois
  - un `version` à faux n'en provoque aucun
- `src/app/core/sidecar/sidecar.service.spec.ts` :
  - `version` pose `sentrySelftest`

Pas de test pour le DSN vide, des deux côtés : le SDK sans DSN est inerte (`captureException` est appelé côté webview, rien ne part), c'est un comportement du SDK que la règle no-lib-test exclut. Aucun test côté webview ne le couvre et ce choix est assumé.

### Integration

- `sidecar/tests/integration/test_ndjson_settings.py` :
  - `get_version` porte `sentry_selftest`, faux sans la variable, vrai avec

## Edge cases

- **Variable posée sans DSN** (build local sans `.env`) : côté sidecar `init_sentry` retourne sans client et `capture_unexpected` ne part nulle part, côté webview `captureException` est appelé mais le SDK sans DSN est inerte. `sentry_selftest` vaut quand même vrai. Le self-test ne vaut que sur un binaire à DSN réel
- **Variable posée chez un utilisateur** : un événement de test par lancement, rien de personnel. Aucun utilisateur n'a de raison de la poser, PRODUCTION.md la décrit comme diagnostic
- **Moteur relancé dans la même session** : nouveau `version`, aucun second événement côté webview ; le sidecar relancé, lui, envoie le sien
- **Quota Sentry** : deux événements par recette, sur 5 000 par mois partagés avec techno-scraper
- **Compte non collaborateur indisponible** : la case du label reste ouverte, le reste de la recette se coche
- **Résumé coupé par Windows** malgré la borne : la borne de `MAX_URL_LENGTH` est trop haute, correctif en `hotfix/*` sur `02-issue-de-retour-sidecar`

## Architectural decisions

### Décision : déclencheur des événements de test

**Options envisagées :**
- **A. Variable d'environnement lue au lancement** : un événement par côté, depuis l'application installée, rejouable à chaque release, petit code testé
- **B. `sentry-cli send-event` et attente d'un vrai incident** : aucun code, mais le payload d'un vrai événement de l'application n'est inspecté qu'au premier incident réel
- **C. Fichier audio corrompu dans un run** : chemin naturel, mais fragile et sans rien côté webview

**Choix : A** (décidé par le propriétaire le 2026-10-16)

**Rationale :**
- La checklist Post-MEP exige un événement réel des deux côtés depuis une application installée, que rien d'autre ne fournit
- Les fausses données portées par l'événement prouvent le masquage sur le vrai pipeline, là où un événement sans donnée sensible ne prouverait rien
