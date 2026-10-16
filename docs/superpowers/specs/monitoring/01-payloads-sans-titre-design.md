---
feature: "Feature 9 : Monitoring"
subproject: "payloads-sans-titre"
goal: "Garantir qu'aucun titre de morceau, nom de fichier ni clé API n'atteint un payload Sentry, côté sidecar comme côté webview, prouvé par un test sur l'enveloppe réellement construite."
status: "draft"
complexity: "M"
tdd_scope: "full"
depends_on: []
date: "2026-10-15"
---

# Payloads Sentry sans titre de morceau

## Scope

Le durcissement Sentry du sidecar passe à l'option `data_collection` (successeur documenté de `send_default_pii` et de `include_local_variables`), toutes catégories fermées. `_scrub` masque le message de toute exception hors d'une liste fermée de types du sidecar. Côté webview, `scrub.ts` masque tout chemin de lecteur ou UNC et toute query string, comme le sidecar et `sentry-options.ts` ferme les catégories de `dataCollection` encore à leur défaut. Le test de sécurité exigé par ADR-014 porte sur l'enveloppe réellement construite par le SDK.

Exclus : le bouton d'envoi de rapport et l'issue GitHub (sub-projects suivants), toute nouvelle intégration Sentry, tout réglage côté serveur Sentry (Advanced Data Scrubbing : le scrubbing serveur s'applique après que la donnée a quitté la machine, il ne tient pas « rien de personnel ne part »), la recette sur bundle installé (`05-recette-monitoring`).

### État livré

À la fin de ce sub-project, on peut : lancer `just test` et voir un test initialiser le vrai SDK avec un transport factice, faire remonter une dérive de contrat de l'API dont la réponse porte un artiste et un titre, puis prouver que l'enveloppe ne contient aucun fragment du titre, du nom de fichier ni de la clé API, aucune variable de frame et que le message d'`ApiContractError` nomme les champs en défaut.

## Dependencies

Aucune : ce sub-project est autoporté.

## Files touched

- **À modifier** : `sidecar/src/tagger/core/observability.py` (`data_collection` fermé à la place d'`include_local_variables`, liste fermée `_SAFE_MESSAGE_TYPES` jugée avant masquage et masque `MESSAGE_MASK` dans `_scrub`, motif de chemin sensible aux guillemets)
- **À modifier** : `sidecar/src/tagger/resolution/scraper_client.py` (`_validate` : détail d'`ApiContractError` construit depuis les erreurs de validation, sans valeur)
- **À modifier** : `sidecar/tests/unit/core/test_observability.py` (règle de masquage des messages, kwargs de `data_collection`, tests de masquage des chemins repris sur la nouvelle règle)
- **À créer** : `sidecar/tests/unit/core/test_sentry_payload.py` (test de sécurité sur l'enveloppe réelle, garde-fou de montée de version)
- **À modifier** : `sidecar/tests/unit/resolution/test_scraper_client_errors.py` (détail d'une réponse qui ne valide pas)
- **À modifier** : `sidecar/tests/conftest.py` (fixture `requests` remontée, `test_sentry_payload.py` et les tests de `resolution/` s'en servent)
- **À supprimer** : `sidecar/tests/unit/resolution/conftest.py` (la fixture `requests` en était l'unique contenu)
- **À modifier** : `src/app/core/observability/scrub.ts` (chemins de lecteur et UNC en `<path>`, query string en `<query>`)
- **À modifier** : `src/app/core/observability/scrub.spec.ts` (cas de chemins, de query string et de schéma d'URL)
- **À modifier** : `src/app/core/observability/sentry-options.ts` (`dataCollection` ferme aussi `graphQL`, `genAI`, `databaseQueryData` et `queues`)
- **À modifier** : `src/app/core/observability/sentry-options.spec.ts` (chemin masqué dans l'événement réellement envoyé, chaque catégorie déclarée fermée)
- **À modifier** : `docs/adrs/014-observabilite-sentry-et-rgpd.md` (mise à jour datée : `data_collection`, liste fermée des messages, ligne `include_local_variables` annotée), via `Skill[architecture-doc]`
- **À modifier** : `docs/ARCHITECTURE.md` (§ Observabilité > Monitoring : les trois réglages deviennent `data_collection` fermé, `server_name` fixe et liste fermée), via `Skill[architecture-doc]`
- **À modifier** : `docs/PRODUCTION.md` (Checklist Pré-MEP « Durcissement Sentry », anti-pattern du titre envoyé à Sentry, lien des options Python), via `Skill[production-doc]`
- **À modifier** : `docs/VERSIONS.md` (§ sentry-sdk : `data_collection` promue en 2.70.0, `include_local_variables` ignorée dès que `data_collection` est posée, `EventScrubber` non installé), via `Skill[versions-doc]`
- **À modifier** : `docs/knowledges/sentry.md` (§ Les trois réglages non négociables (Python), Scrubbing par `before_send`, Anti-Patterns), via `Skill[knowledge-doc]`
- **À modifier** : `.claude/rules/sentry/python.md` (règles `data_collection`, liste fermée et `EventScrubber` absent, `observability.py` ajouté aux `paths` du frontmatter), via `Skill[rules-doc]`
- **À modifier** : `.claude/rules/sentry/angular.md` (masquage des chemins de lecteur et UNC dans `scrub.ts`, dix catégories de `dataCollection`), via `Skill[rules-doc]`
- **À modifier** : `.claude/rules/pytest/tests.md` (exceptions : le test de l'enveloppe initialise le vrai SDK avec un transport factice, le garde-fou de `data_collection` casse à la montée du SDK), via `Skill[rules-doc]`

## Architecture approach

- **`data_collection` fermé, catégorie par catégorie** (`.claude/rules/sentry/python.md`, ADR-014) : `user_info` à `False`, `cookies`, `http_headers.request` et `url_query_params` en `{"mode": "off"}`, `http_bodies` à `[]`, `graphql`, `gen_ai`, `database_query_data` et `queues` fermés, `stack_frame_variables` à `False`. `frame_context_lines` garde le défaut du SDK : ce sont des lignes du code du dépôt, public (ADR-021). `server_name=APP_NAME`, `before_send=_scrub`, la `LoggingIntegration` coupée et `auto_enabling_integrations=False` restent tels quels. `include_local_variables` est retiré : le SDK ne le lit plus dès que `data_collection` est posé (constaté dans le source de sentry-sdk 2.71.0, `utils.py` et `data_collection.py`, le 2026-10-15)
- **`EventScrubber` du SDK absent sous `data_collection`** (constaté le 2026-10-16 dans `client.py` de sentry-sdk 2.71.0, `_get_options` : « Do not add the event scrubber if data collection is enabled ») : le denylist par défaut (`api_key`, `secret`, `token`, `password`...) ne s'applique plus aux champs libres de l'événement. Il ne couvrait que des clés de dictionnaire et ne reconnaissait ni un titre ni un nom de fichier et `_scrub` ne le rappelle pas à la main. La conséquence se règle à l'écriture : aucune donnée sensible dans `set_extra`, `set_context` ni `set_tag`, consigné dans VERSIONS.md, `knowledges/sentry.md` et `.claude/rules/sentry/python.md`
- **Liste fermée des messages dans `_scrub`** : pour chaque entrée de `exception.values`, la `value` est remplacée par `MESSAGE_MASK` (`<message>`) sauf si `module` + `type` figurent dans `_SAFE_MESSAGE_TYPES`, frozenset de noms qualifiés tenu dans `observability.py`, qui contient `tagger.resolution.scraper_client.ApiContractError` au 2026-10-15. Tous les noms de la liste commencent par `tagger.` : le préfixe n'est pas testé à part. Le type, le module, le mécanisme et la pile partent toujours (`module` vaut `None` pour un builtin, comme le pose le SDK). Le masquage existant (`<path>`, `<query>`, `<user>`) reste appliqué à la `value` conservée et à tout le reste de l'événement. La décision se prend sur les champs de l'événement, pas sur l'exception du `hint` : elle couvre de la même façon `capture_unexpected`, le crash attrapé par l'excepthook du SDK et chaque membre d'un `ExceptionGroup`, sans apparier une chaîne d'exceptions à une liste de valeurs. Elle se prend sur `module` et `type` d'origine, avant `_mask_deep` : le masquage du compte de l'OS réécrit `module` et un nom de compte sous-chaîne de `scraper_client` (constaté le 2026-10-16 avec `client`) ferait perdre le message d'`ApiContractError`
- **Pas d'import du domaine dans `core/`** : la liste nomme les types par leur nom qualifié plutôt que d'importer `ApiContractError` dans `core/observability.py`, qui n'importe aucun package métier (constaté le 2026-10-16). Un type déplacé ou renommé fait échouer le test de l'enveloppe, qui lit le message d'`ApiContractError` dans `exception.values`
- **Un type n'entre dans la liste que si son message est construit sans aucune donnée** (`.claude/rules/python/gestion-erreurs.md` : le `code` et les `params` vivent en attributs). Les messages qui portent `path.name` (`TagsWriteError`, `RenameError`, `TagDumpWriteError` et les autres) en restent exclus et le `KeyError(track_id)` de `tag_dump.py` aussi : le `track_id` est le chemin relatif du fichier (`run/tagging.py`), qu'aucun motif de chemin absolu ne reconnaît
- **Diagnostic d'une dérive de l'API sans valeur** (`.claude/rules/pydantic/modeles.md`) : `_validate` construit le détail d'`ApiContractError` depuis `ValidationError.errors(include_input=False, include_url=False, include_context=False)`, soit le nom du modèle puis, pour chaque erreur, son emplacement et son type. Les indices de liste deviennent `*` et les paires identiques sont dédoublonnées, pour qu'une dérive qui touche les cent items d'une page tienne en une ligne. Une erreur à la racine de la réponse n'a pas d'emplacement : seul son type s'écrit (`TrackPage: model_type`). La chaîne `from exc` est gardée : le traceback complet reste dans le fichier de log local, que PRODUCTION.md § Logging autorise à porter des chemins
- **Motif de chemin sensible aux guillemets, des deux côtés** : un chemin ouvert par `"` court jusqu'au `"` suivant, un chemin ouvert par `'` jusqu'à la dernière apostrophe de la ligne (glouton avec lookahead, `(?:[^\r\n]*(?=')|[^'\r\n]*)`) et jusqu'à la fin de ligne s'il n'y a pas d'apostrophe fermante, de sorte qu'une apostrophe du nom ne le ferme pas, qu'elle précède une lettre ou une espace et que le texte entre deux apostrophes qui suit le chemin est avalé avec lui (sur-masquage accepté), un chemin nu garde ses apostrophes et ses espaces et s'arrête à `"`, `<>`, la fin de ligne, `: ` et, côté sidecar, avant un champ logfmt de la liste fermée. Le motif précédent s'arrêtait à la première apostrophe : `D:\Music\Don't Stop.mp3` laissait partir `'t Stop.mp3`. `repr()` de Python entoure de guillemets doubles un chemin qui contient une apostrophe, le cas du message d'un `OSError` est donc couvert (motif vérifié sur ces formes en Python et en JS le 2026-10-15, branche `'` gloutonne vérifiée le 2026-10-16 sur `'D:\Music\Guns N' Roses - Paradise.mp3'`, `'D:\Music\x.mp3' and 'E:\y.mp3'`, un chemin sans apostrophe fermante et les formes `"..."`, nues, `: `, logfmt et URL, en Python et en JS)
- **Webview alignée sur le sidecar** (`.claude/rules/sentry/angular.md`) : `scrub.ts` applique, dans le même ordre que `_mask`, la query string d'URL en `<query>`, puis tout chemin de lecteur ou UNC en `<path>` par le même motif, puis le dossier personnel restant (`/Users/x`, `/home/x`, `\Users\x` sans lettre) en `<user>`. Les messages JS restent envoyés : ils sont le seul diagnostic de la webview et une donnée de morceau n'y entre que par un chemin ou une URL. `sentry-options.ts` ferme les quatre catégories de `dataCollection` encore à leur défaut (`graphQL`, `genAI`, `databaseQueryData`, `queues`, noms lus dans `@sentry/core` 11.6.0 le 2026-10-16), soit les dix catégories connues à cette date, `frameContextLines` exceptée. La webview n'a pas de garde-fou d'exécution comme le sidecar : le test vérifie que chaque clé déclarée est fermée et que la liste déclarée est celle des catégories connues, une catégorie ajoutée par une montée du SDK reste à son défaut tant qu'on ne la ferme pas à la main
- **Tests sur ce que le SDK envoie** (`.claude/rules/pytest/tests.md`, `.claude/rules/angular/tests.md`) : le test de l'enveloppe initialise le vrai SDK par `init_sentry` avec un transport factice qui retient l'enveloppe, aucun réseau ni quota. Le client est remis à zéro après le test pour ne pas fuir dans la suite. Il prouve une règle du projet (rien de personnel ne part), pas le comportement du SDK : il échoue si notre configuration ou notre `_scrub` régresse et aussi si une montée du SDK rouvre une catégorie, ce qui est le but. Ces deux traits contredisent la lettre de `.claude/rules/pytest/tests.md` (« Sentry réel » et « un test qui casse à la mise à jour d'une dépendance est un test à supprimer ») : la rule est amendée par ce sub-project. Une valeur attendue s'asserte sur le champ de l'événement (`exception.values`), jamais par sa présence dans le texte de l'enveloppe : le SDK y joint cinq lignes de source autour de la frame du test, dont la littérale de l'assertion (vérifié le 2026-10-16 : une assertion sur le texte passait avec la liste fermée vidée)
- **Garde-fou de montée de version** : un test lit le `data_collection` résolu du client initialisé et exige que chaque catégorie soit fermée, `frame_context_lines` excepté. Sentry suit l'ajout d'une catégorie `mcp` à `data_collection` ([getsentry/sentry-python#7750](https://github.com/getsentry/sentry-python/issues/7750), ouverte au 2026-10-15). Sous `data_collection` explicite, une catégorie omise est collectée par défaut : le test casse à la montée au lieu de laisser fuiter

## Acceptance criteria

### Scénario 1 : dérive du contrat de l'API
**GIVEN** une réponse de recherche hors contrat dont les items portent un artiste et un titre
**WHEN** `_validate` lève `ApiContractError` et `capture_unexpected` la remonte
**THEN** l'enveloppe construite par le SDK ne contient aucun fragment de l'artiste ni du titre
**AND** le message d'`ApiContractError` nomme le modèle, l'emplacement et le type de chaque erreur, indices remplacés par `*`
**AND** l'entrée de la `ValidationError` chaînée garde son type et sa pile, son message vaut `<message>`

### Scénario 2 : exception qui porte un nom de fichier
**GIVEN** une exception du sidecar dont le message porte `path.name`, ou un `KeyError` sur un `track_id`
**WHEN** elle remonte à Sentry
**THEN** son message vaut `<message>` dans l'enveloppe
**AND** son type, son module (`None` pour un builtin, comme le pose le SDK) et sa pile sont présents dans l'enveloppe

### Scénario 3 : variables locales et machine
**GIVEN** une frame dont une variable locale porte un titre de morceau et une autre une clé API
**WHEN** une exception y remonte à Sentry
**THEN** l'enveloppe ne contient aucune variable de frame, ni le titre ni la clé
**AND** `server_name` vaut le nom de l'application

### Scénario 4 : montée du SDK qui ajoute une catégorie de collecte
**GIVEN** une version de sentry-sdk dont `data_collection` résolu compte une catégorie que notre configuration ne ferme pas
**WHEN** la suite de tests du sidecar tourne
**THEN** le garde-fou échoue en nommant la catégorie ouverte

### Scénario 5 : erreur de la webview qui porte un chemin
**GIVEN** une erreur de la webview dont le message porte `D:\Musique\Nova Pulse - Your Mind.mp3` ou un chemin UNC
**WHEN** le SDK Angular construit l'événement
**THEN** le chemin entier vaut `<path>`, aucun fragment du nom de fichier ne reste
**AND** le reste du message est conservé

## Tests à écrire

### Unit

- `sidecar/tests/unit/core/test_observability.py` :
  - le masque `<message>` remplace la valeur d'une exception hors de la liste fermée, son type et son module restant intacts
  - la valeur d'un type de la liste fermée est gardée, chemins toujours masqués
  - un type qui porte le nom d'un type de la liste mais vient d'un module hors de `tagger.` est masqué
  - un type de la liste garde son message même quand le nom de compte de l'OS est une sous-chaîne de son module
  - `init_sentry` ne passe plus `include_local_variables` et passe un `data_collection` qui ferme `user_info` et `stack_frame_variables` : la fermeture de chaque catégorie est prouvée par le test de l'enveloppe
  - les tests de masquage des chemins, du compte et de la query string sont repris sur les champs libres (`message`, `extra`, `tags`) et sur une entrée d'`ApiContractError`
  - un chemin nu qui contient une apostrophe, un chemin entre guillemets doubles qui en contient une, un chemin entre apostrophes dont le nom porte une apostrophe avant une lettre (`Don't`) ou avant une espace (`Guns N' Roses`) et le message d'un `OSError` sur un tel chemin sont masqués en entier
  - le texte entre deux apostrophes qui suit un chemin entre apostrophes est avalé avec lui (`'<path>'s folder` pour `'D:\x.mp3' from user's folder`), sur-masquage accepté
- `sidecar/tests/unit/core/test_sentry_payload.py` :
  - aucune enveloppe ne contient de fragment du titre, de l'artiste ni de la clé API sur une dérive de contrat, paramétré sur trois formes de réponse dont la valeur fautive porte l'artiste ou le titre (champ au mauvais type, champ requis absent, item qui n'est pas un objet)
  - le détail d'`ApiContractError` se lit dans `exception.values` (nom du modèle, emplacement et type) et l'entrée de la `ValidationError` chaînée garde son type, son module et sa pile avec le message `<message>`
  - une exception portant `path.name` et un `KeyError(track_id)` sortent en `<message>`, sans fragment du nom, avec leur type, leur module et leur pile
  - un `ExceptionGroup` levé sort avec chaque entrée de `exception.values` en `<message>`, sans fragment du nom
  - l'enveloppe ne porte aucune variable de frame et un `server_name` fixe, une variable locale portant un titre et une clé
  - le `data_collection` résolu ferme chaque catégorie, `frame_context_lines` excepté
  - le teardown de la fixture vérifie que le client réel est remplacé par un client inactif
- `sidecar/tests/unit/resolution/test_scraper_client_errors.py` :
  - une réponse qui ne valide pas lève une `ApiContractError` dont le message nomme le modèle, l'emplacement et le type de chaque erreur sans aucune valeur, indices remplacés par `*` et doublons retirés
  - une réponse qui n'est pas un objet nomme le type seul, sans espace de trop
- `src/app/core/observability/scrub.spec.ts` :
  - un chemin de lecteur, en barres obliques comme inverses, est masqué en entier, nom de fichier compris
  - un chemin UNC est masqué en entier
  - un chemin nu, entre guillemets doubles ou entre apostrophes (apostrophe avant une lettre ou avant une espace) qui contient une apostrophe est masqué en entier
  - le texte entre deux apostrophes qui suit un chemin entre apostrophes est avalé avec lui, sur-masquage accepté
  - la query string d'une URL est masquée, schéma, hôte et chemin gardés
  - le schéma d'une URL n'est pas pris pour une lettre de lecteur
  - les formes POSIX du dossier personnel restent masquées en `<user>`
- `src/app/core/observability/sentry-options.spec.ts` :
  - une erreur dont le message porte un chemin de lecteur est envoyée avec ce chemin en `<path>`
  - chaque clé déclarée de `dataCollection` est fermée et la liste déclarée est celle des dix catégories connues au 2026-10-16

## Edge cases

- **`ExceptionGroup` d'un `TaskGroup`** : chaque membre est une entrée de `exception.values` jugée pour elle-même. Le message du groupe, de type `builtins`, est masqué
- **Type de la liste déplacé ou renommé** : son message passe en `<message>`, le test de l'enveloppe échoue sur la valeur de l'entrée `ApiContractError` lue dans `exception.values`
- **Champ `dict[str, ...]` ajouté à un modèle de l'API** : l'emplacement d'une erreur de validation y porterait une clé venue de la réponse, indiscernable d'un nom de champ dans `loc`. Aucun modèle de `scraper_client.py` n'en valide le contenu au 2026-10-15 (`_ProfileEnvelope.profile` est un `dict[str, object]` qui accepte tout). La contrainte s'écrit dans la docstring de `_contract_detail`, la fonction qui construit le détail : un tel champ ne s'ajoute qu'en sortant ses clés du détail
- **Chemin nu suivi de texte** : un texte collé au chemin sans `: ` ni champ logfmt est avalé avec lui, sur-masquage accepté des deux côtés
- **Texte entre deux apostrophes après un chemin entre apostrophes** : le chemin court jusqu'à la dernière apostrophe de la ligne, le texte intermédiaire est avalé avec lui (`'D:\Music\x.mp3' from user's folder` donne `'<path>'s folder`, `'D:\Music\x.mp3' and 'E:\y.mp3'` donne `'<path>'`), sur-masquage accepté des deux côtés. Un chemin entre apostrophes sans apostrophe fermante court jusqu'à la fin de ligne. Plus aucune fuite résiduelle sur un nom à apostrophe (« Don't Stop.mp3 », « Guns N' Roses.mp3 »), `repr()` passant de toute façon aux guillemets doubles pour un tel nom (vérifié le 2026-10-16)
- **Nom de compte de l'OS sous-chaîne du module d'un type de la liste** : la liste se juge avant `_mask_deep`, le message reste lisible (`module` est alors réécrit en `<user>` dans l'enveloppe, la décision a déjà été prise)
- **`send_default_pii` posé à côté de `data_collection`** : le SDK l'ignore et émet un `DeprecationWarning`. Il reste absent des deux côtés

## Architectural decisions

### Décision : configuration du SDK Python

**Options envisagées :**
- **A. Garder `include_local_variables=False` et `send_default_pii` au défaut** : aucun changement, une catégorie ajoutée par le SDK suit le repli conservateur de `send_default_pii=False`. Mais `send_default_pii` est annoncé déprécié au profit de `data_collection` et le sidecar ne suit pas le même modèle que la webview
- **B. `data_collection`, chaque catégorie fermée explicitement** : option documentée depuis la 2.70.0, même modèle que le `dataCollection` de la webview. Une catégorie omise étant collectée par défaut, elle exige le garde-fou de montée de version

**Choix : B**

**Rationale :**
- C'est l'option que le SDK fait évoluer, celle sur laquelle les nouvelles catégories arrivent
- Le garde-fou transforme son seul risque, une catégorie ajoutée ouverte, en test rouge
- Une seule règle pour les deux SDK : chaque catégorie connue fermée. Le sidecar la prouve sur le `data_collection` résolu du client réel, avec un garde-fou qui nomme toute catégorie ouverte. La webview ne ferme que la liste des catégories connues au 2026-10-16, sans garde-fou d'exécution

### Décision : messages d'exception

**Options envisagées :**
- **A. Liste fermée de types sans donnée** : tout message est masqué par défaut, sauf les types du sidecar déclarés sans donnée. Une exception ajoutée plus tard est couverte d'office
- **B. Correction à la source** : couper la chaîne dans `_validate` (`from None`) et remplacer le `KeyError(track_id)`. Ferme les cas connus seulement, les messages qui portent `path.name` restent exposés s'ils remontent
- **C. Tout masquer** : seuls le type et la pile partent. Perd le modèle et les champs en défaut d'une dérive de l'API, le diagnostic le plus utile

**Choix : A** (décidé par le propriétaire le 2026-10-15)

**Rationale :**
- Le texte libre ne permet pas de reconnaître un titre : une liste fermée est la seule règle qui tienne sans connaître le contenu
- Le diagnostic d'une dérive de l'API survit, construit sans valeur
- Le défaut est le masquage, donc un oubli fuit moins qu'un ajout
