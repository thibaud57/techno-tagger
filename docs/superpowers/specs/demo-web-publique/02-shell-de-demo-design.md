---
feature: "Post-MVP Feature 1 : Démo web publique"
subproject: "shell-de-demo"
goal: "Construire l'interface Angular dans une configuration demo qui démarre dans un navigateur nu, se présente comme une démo, accueille le visiteur dans sa langue et explique les actions indisponibles"
status: "implemented"
complexity: "XL"
tdd_scope: "partial"
depends_on: ["01-enregistreur-de-scenario-design.md"]
date: "2026-10-25"
---

# Shell de démo

## Scope

Ce lot couvre :
- une configuration Angular `demo`, avec son point d'entrée, sa page `index` et ses scripts, qui démarre l'app dans un navigateur sans Tauri ni sidecar ;
- les remplaçants de démo des quatre accès natifs ;
- un transport qui répond aux deux commandes du démarrage depuis le scénario du lot 1 ;
- le bandeau de démo ;
- la langue reçue du portfolio ;
- les actions grisées en démo, avec leur raison en tooltip.

Aucun module de démo n'entre dans le bundle desktop, et le desktop garde son comportement. Exclut le rejeu du parcours (lot 3), l'image, la CI et Dokploy (lot 4), ainsi que le portfolio, qui ajoutera `?lang` à son lien dans son propre dépôt.

### État livré

À la fin de ce sub-project, on peut :
- ouvrir `just dev-demo` avec `?lang=en` et voir l'app en anglais, sur l'onglet Playlist, avec le bandeau et sans écran bloquant ;
- constater que l'URL a perdu le paramètre ;
- cliquer sur « Choisir » et voir le champ se remplir d'un chemin fictif du scénario ;
- survoler le bouton « Enregistrer » de la clé API, grisé, et lire pourquoi.

## Dependencies

- `01-enregistreur-de-scenario-design.md` (statut: draft) : le format de `src/demo/scenario.json`, ses chemins de démo (`paths`), ses réponses initiales (`get_version`, `get_interrupted_run`) et ses pochettes `artworks/<référence>.svg`. Le modèle exact est fixé par `docs/superpowers/plans/demo-web-publique/01-enregistreur-de-scenario.md`, Task 3, bloc Interfaces. Le lot 1 est implémenté avant celui-ci (ordre topologique) : `src/demo/` existe quand ce lot démarre.

## Références de design

- **Maquette** : `ui_kits/techno-tagger/AppShell.jsx` (fonction `AppShell`, entre la barre `Tabs` et le conteneur du contenu), `SettingsScreen.jsx` (`SettingsScreen` : clé API, seuils, cache, logs, version), `TaggingScreen.jsx` (`Recap` : « Envoyer ce rapport », `TrackDetail` : « Restaurer ce morceau », lien de la fiche source)
- **Design system** : `components/feedback/Message.prompt.md`, `forms/Button.prompt.md` (variante `link`), `overlay/Tooltip.prompt.md` (`force`, exception « raison d'une action désactivée »), `forms/SettingsRow.prompt.md`, `forms/Password.prompt.md`, `forms/Slider.prompt.md`, `forms/InputNumber.prompt.md`, `navigation/Tabs.prompt.md`
- **Options validées le 2026-10-25** : bandeau B de `docs/superpowers/specs/demo-web-publique/02-bandeau-options.html` (bande neutre sous la barre d'onglets), rendu téléphone de `02-telephone-options.html` (page déclarée à 1280px), toutes deux à côté de ce spec. Leurs décisions sont recopiées ci-dessous et rejoignent DESIGN.md.
- **Arbitrages en vigueur** (`docs/DESIGN.md` § Maquette et design system externes > Arbitrages) : icônes en SVG inline par `IconComponent` ; logo `size-5` dans la barre d'onglets ; barre d'onglets fusionnée avec la barre de titre, 40px.
- Règle de lecture : `.claude/rules/design/claude-design.md`. La maquette et le design system sont un export local sous `.design-sync/design-system/` (gitignoré) : les chemins `ui_kits/…` et `components/…` ci-dessus s'y lisent.

## Files touched

- **À créer** : `src/main.demo.ts` (bootstrap sans `Sentry.init`)
- **À créer** : `src/index.demo.html` (copie d'`index.html` : `viewport` à `width=1280`, titre « Techno Tagger (démo) », `<meta name="robots" content="noindex">`)
- **À créer** : `src/app/demo/demo.config.ts` (`mergeApplicationConfig(appConfig, …)`)
- **À créer** : `src/app/demo/scenario.ts` + `scenario.spec.ts` (miroir TypeScript du modèle du lot 1, `parseScenario`)
- **À créer** : `src/app/demo/demo-scenario.service.ts` (charge `demo/scenario.json` une fois)
- **À créer** : `src/app/demo/replay-transport.ts` + `replay-transport.spec.ts` (chargement du scénario, réponses initiales seulement)
- **À créer** : `src/app/demo/demo-native.service.ts` + `demo-native.service.spec.ts`
- **À créer** : `src/app/demo/demo-preferences.service.ts` + `demo-preferences.service.spec.ts`
- **À créer** : `src/app/demo/demo-language.ts` + `demo-language.spec.ts`
- **À créer** : `src/app/demo/demo-platform.ts` (fenêtre et updater de démo)
- **À créer** : `src/app/demo/demo-banner.component.ts` + `.html` + `.spec.ts`
- **À créer** : `src/app/core/platform/app-edition.ts` (jetons `APP_EDITION` et `APP_BANNER`)
- **À créer** : `src/fixtures/demo-scenario.ts` (constructeur `scenarioWith` des scénarios de test, partagé avec le lot 3)
- **À créer** : `sidecar/tests/unit/test_demo_scenario_mirror.py` (garde du miroir)
- **À modifier** : `sidecar/tests/helpers/protocol_mirror.py` (lecture d'un second fichier TypeScript : paramètre `source`, cache par chemin)
- **À modifier** : `angular.json` (configuration `demo` de `build` et de `serve`)
- **À modifier** : `package.json` (scripts `build:demo`, `start:demo`)
- **À modifier** : `Justfile` (recettes `dev-demo`, `build-demo`, via `Skill[justfile-creator]`)
- **À modifier** : `.github/workflows/ci.yml` (job `ui` : garde du bundle desktop après `just build-ui`)
- **À modifier** : `.claude/skills/dev-server/SKILL.md` (recette `dev-demo`) et `.claude/skills/quality-check/SKILL.md` (recette `build-demo`), via `Skill[skill-creator]`, puis `.claude/CLAUDE.md` (table des commandes, via `Skill[claude-md-doc]`)
- **À modifier** : `src/app/core/platform/native.service.ts` (`pickPath(target: PathTarget)`)
- **À modifier** : `src/app/features/playlist/playlist-page.component.ts` + `.html` (cibles `library`, `destination`, `playlist`)
- **À modifier** : `src/app/features/tagging/run/tagging-page.component.ts` (cible `tagging_folder`)
- **À modifier** : `src/fixtures/native-stub.ts` et les specs qui appellent `pickPath` (nouvelle signature)
- **À modifier** : `src/app/app.component.ts` + `.html` + `.spec.ts` (emplacement du bandeau, contrôles de fenêtre masqués en démo)
- **À modifier** : `src/app/features/settings/settings-page.component.ts` + `.html` + spec (raisons de démo)
- **À modifier** : `src/app/features/tagging/recap/feedback-send.ts` + spec (raison de démo)
- **À modifier** : `src/app/features/tagging/run/track-detail.component.ts` + `.html` + spec (restauration d'un morceau, fiche source)
- **À modifier** : `public/i18n/fr.json`, `public/i18n/en.json` (namespace `demo`)
- **À modifier** : `docs/DESIGN.md` (Mapping : bandeau de démo ; Layout : rendu téléphone de la démo)
- **À modifier** : `docs/ARCHITECTURE.md` (arborescence : `src/app/demo/`, `src/main.demo.ts`, `src/index.demo.html`)
- **À modifier** : `.design-sync/NOTES.md` (Reste ouvert : bandeau absent de la maquette)

## Architecture approach

- **Configuration `demo`, empilée sur `production`** (`.claude/rules/angular/app-config.md`) :
  - Angular CLI accepte plusieurs configurations séparées par des virgules et les fusionne dans l'ordre, au premier niveau seulement (vérifié le 2026-10-25 dans `@angular-devkit/architect`). Le build de démo est `--configuration production,demo` : budgets, `outputHashing` et `optimization` viennent de `production` sans copie, `demo` ne porte que ce qui lui est propre.
  - `build.configurations.demo` : `browser: "src/main.demo.ts"`, `index: "src/index.demo.html"`, `outputPath: "dist/techno-tagger-ui-demo"`, `sourceMap: false`. `frontendDist` de Tauri reste sur la sortie desktop.
  - `assets` : `public` plus `{ "glob": "**/*", "input": "src/demo", "output": "demo" }`. `src/demo/` n'est copié que dans ce build.
  - **Servie à la racine** de `demo-techno-tagger.thibaud-geisler.com` (décision du 2026-10-25) : `<base href="/">` et le chargement de `/i18n/` restent tels quels. Les fichiers de démo se lisent en absolu, `/demo/scenario.json` et `/demo/artworks/…`.
  - `define` : la fusion étant superficielle, un `define` dans `demo` remplacerait celui des options de base en bloc. `demo` n'en porte donc aucun : `APP_ENVIRONMENT` passe par `--define`, fusionné clé par clé avec les options, et `SENTRY_DSN_UI` garde leur `''` (réaligné le 2026-10-26 à la clôture de l'epic).
  - `serve.configurations.demo` : `buildTarget: "techno-tagger-ui:build:development,demo"`, pour un `just dev-demo` aussi rapide que `dev-ui`.
- **Scripts** (`.claude/rules/pnpm/workspace.md`) :
  - `build:demo` (`--configuration production,demo`) et `start:demo` (`--configuration demo` de `serve`) passent `PRIMENG_LICENSE_KEY` et `APP_VERSION` par `--define`, comme `build` et `start` ; `build:demo` seul y ajoute `APP_ENVIRONMENT='demo'`, le serveur de développement gardant `development` et donc `failOnError` ;
  - `build:demo` n'enchaîne pas `sourcemaps`, rien n'est envoyé à Sentry ;
  - recettes `just dev-demo` et `just build-demo`, écrites via `Skill[justfile-creator]`.
- **Bootstrap** :
  - `main.demo.ts` appelle `bootstrapApplication(AppComponent, demoConfig)` sans `Sentry.init` (`.claude/rules/sentry/angular.md` : rien ne part) ;
  - `demoConfig = mergeApplicationConfig(appConfig, { providers })`. Les providers de démo remplacent ceux de base, sans toucher `app.config.ts`.
  - Sentry n'est pas initialisé, et la démo ne dépend pas du comportement du SDK dans cet état : `demoConfig` remplace `ErrorHandler` par celui d'Angular (console) et `CAPTURE_EXCEPTION` par un envoi en console (mon choix, 2026-10-25). `SentrySelftestService` reste inerte, la ligne `version` du scénario portant `sentry_selftest: false`. Le SDK reste dans le bundle, le DSN vide : la vérification du build greppe l'absence de tout hôte d'ingestion Sentry.
  - **Garde du bundle desktop** : le job `ui` de la CI, après `just build-ui`, échoue si `dist/techno-tagger-ui/browser` contient `demo/`, `scenario.json` ou `app-demo-banner`. Les clés i18n `demo.*` entrent dans `public/i18n`, donc dans le desktop, où rien ne les lit : ce sont des textes, pas du code, et c'est accepté (décision du 2026-10-25).
- **Édition de l'app** (`app-edition.ts`, `.claude/rules/typescript/types.md`) :
  - `type AppEdition = "desktop" | "demo"`. Le jeton `APP_EDITION` vaut `"desktop"` par défaut (factory `providedIn: "root"`), et `demoConfig` fournit `"demo"`.
  - Le jeton `APP_BANNER: InjectionToken<Type<unknown> | null>` vaut `null` par défaut. `demoConfig` fournit `DemoBannerComponent`, rendu par `NgComponentOutlet` entre `</p-tabs>` et `<main>` dans `app.component.html`. AppComponent n'importe aucun composant de démo.
- **Scénario** (`scenario.ts`) :
  - Les types TypeScript reprennent le modèle pydantic du lot 1 : `Scenario` (avec `key_fields` et `initial_outcomes`), `DemoPaths`, `StatelessReply`, `StatefulReply`, `Outcome`, `Phase`. Les unions de littéraux sont les valeurs des `StrEnum`.
  - `parseScenario(raw: unknown): Scenario` réduit le JSON chargé et lève `DemoScenarioError` sur une version de schéma inconnue, un champ manquant, une issue ou une phase hors des littéraux connus, ou un index de ligne hors table (parse, don't validate : rien n'est casté).
  - `test_demo_scenario_mirror.py` compare champs et littéraux au modèle Python, comme `test_protocol_mirror.py`. `protocol_mirror.py` lit aujourd'hui un seul fichier, mis en cache sans paramètre : il reçoit un paramètre `source` (défaut `protocol.ts`) sur ses lecteurs, le cache devenant par chemin, et les littéraux d'une union dérivée d'un tableau `as const` se lisent par `ts_unions`, pas par `ts_union_members` qui liste des interfaces.
  - `DemoScenarioService.load()` charge `/demo/scenario.json` une seule fois et `scenario()` le rend ensuite de façon synchrone. Le chargement n'est pas confié à un initializer : Angular lance tous les initializers d'un coup puis attend leurs promesses (vérifié le 2026-10-25, `runInitializers`), et celui du sidecar envoie `get_version` dès que le transport a démarré. C'est donc `ReplayTransport.start()` qui attend `load()`.
- **Transport de démo** (`replay-transport.ts`, `.claude/rules/angular/services.md`) :
  - `ReplayTransport` implémente `SidecarTransport`. `start(handlers)` attend `DemoScenarioService.load()`, puis rend `true`. Si le scénario est introuvable ou invalide, il écrit l'erreur en console et rend `false` : l'écran bloquant s'affiche.
  - `send(line)` répond aux deux commandes que l'interface envoie au démarrage, enregistrées par le lot 1 : `get_version` et `get_interrupted_run`, chacune par sa réponse sans état de rang 1.
  - Dans la ligne `version`, `version` reprend `APP_VERSION`, sinon `versionMismatch` bloquerait l'app.
  - Toute autre commande reste sans réponse : le lot 3 complète ce transport. Jusque-là, les Réglages restent en chargement sur l'historique et le cache.
- **Natifs de démo** :
  - **`NativeService` reçoit une cible au lieu d'un booléen** : `type PathTarget = "library" | "destination" | "playlist" | "tagging_folder"`. Le desktop en déduit `directory`. Les trois sélecteurs de dossier passaient tous `directory: true` et ne se distinguaient pas.
  - **`DemoNativeService`** (`useClass`) renvoie le chemin du scénario pour chaque cible : `library` → `paths.library`, `destination` et `tagging_folder` → `paths.destination`, `playlist` → `paths.vlc_dump`. `assetUrl(path)` rend `/demo/<path>` pour une pochette `artworks/…`. `openUrl` et `revealItemInDir` ne font rien : tous leurs appelants sont grisés en démo (fiche source, envoi du rapport) et l'updater de démo ne propose rien. La démo n'ouvre aucune page.
  - **`DemoPreferencesService`** garde les six préférences de `PreferencesService` dans `localStorage`, sous un préfixe propre à la démo. Si le navigateur refuse le stockage (`DOMException` levée par `localStorage`, navigation privée), les préférences vivent le temps de la session ; toute autre erreur remonte. Une langue relue du stockage est revalidée contre `LANGUAGES` : une valeur falsifiée est ignorée.
  - **Typage** : `PreferencesService` et `NativeService` n'ont aucun membre privé, comme le montre `src/fixtures/preferences-stub.ts`. Les classes de démo les déclarent en `implements` et se fournissent par `useClass`, sans extraire de contrat ni toucher au desktop.
  - **`demo-platform.ts`** fournit un `APP_UPDATER` dont `check()` rend `null`, et un `APP_WINDOW` sans effet.
- **Langue** (`.claude/rules/ngx-translate/i18n.md`) :
  - `takeLanguageFromQuery(location, history)` lit `?lang`. `fr` et `en` sont pris, toute autre valeur est ignorée. Le paramètre est retiré de l'URL par `history.replaceState` dans les deux cas.
  - `DemoPreferencesService.readLanguage()` rend d'abord cette langue et l'enregistre, puis le choix déjà enregistré. Sans l'un ni l'autre, `resolveStartupLanguage` retombe sur `navigator.language`.
  - Ordre retenu : `?lang`, puis le choix fait dans les Réglages, puis le navigateur.
  - La langue prise dans l'URL est enregistrée aussitôt : une lecture suivante rend le même résultat, sans dépendre du paramètre déjà retiré.
- **Bandeau de démo** (option B, `.claude/rules/tailwindcss/utilitaires.md`, `.claude/rules/tailwindcss/echelles.md`) :
  - bande de `h-8` sur toute la largeur, `bg-surface-900`, filet `border-b border-surface-800` ;
  - texte `text-xs text-muted-color` centré, icône `info-circle` en 16px par `IconComponent` ;
  - puis le bouton `link` « Me contacter », une ancre vers `https://thibaud-geisler.com/<langue>/contact` dans un nouvel onglet (`rel="noopener noreferrer"`), où `<langue>` suit la langue courante. Le seul lien sortant de la démo. Les pages `/fr/contact` et `/en/contact` du portfolio sont un prérequis que le lot 4 inscrit dans PRODUCTION.md.
  - L'adresse vit dans une constante de `src/app/demo/`.
  - Les textes passent par ngx-translate (`demo.banner.text`, `demo.banner.contact`), aucun libellé en dur. Le texte exact des deux langues est fixé dans les Global Constraints du plan, seule source : « Démo : données fictives, aucun fichier réel. Application privée, non affiliée à Beatport ni Bandcamp. » et son anglais. Aucun lien de téléchargement : l'app est privée (décision du propriétaire, 2026-10-25).
  - C'est un nouveau motif, écart au design system tranché le 2026-10-25 : il entre dans DESIGN.md § Mapping. Le lot 3 y ajoute un second lien `link`, « Recommencer la démo », et met la ligne de DESIGN.md à jour.
  - **Hauteur** : l'hôte d'AppComponent est une colonne flex à la hauteur de la fenêtre (`flex h-screen flex-col`), et `<main>` est `flex-1 min-h-0`. Le bandeau, de hauteur fixe, prend ses 32px sur `<main>`, et la table du run, en `scrollHeight="flex"`, rétrécit d'autant. La page ne défile toujours pas, aucun autre réglage de layout n'est nécessaire.
- **Indisponible dans la démo** (`.claude/rules/primeng/composants.md`, `.claude/rules/angular/components.md`) :
  - Chaque composant concerné injecte `APP_EDITION`. En démo, sa raison de blocage existante prend en premier la clé `demo.unavailable`, et le motif « bouton grisé + tooltip » déjà en place l'affiche (`TOOLTIP`, `src/app/shared/utils/tooltip.ts`). Aucune logique de démo ailleurs que dans ces raisons.
  - **Réglages** :
    - clé API : champ et « Enregistrer » grisés, raison sur le bouton ;
    - seuils : curseurs et champs grisés, raison sur « Rétablir les valeurs par défaut » ;
    - « Ouvrir le dossier de logs » ;
    - « Rechercher une mise à jour », qui n'avait pas de tooltip ;
    - « Vider le cache ».
    « Restaurer le dernier run », les runs passés, la langue et le signal sonore restent actifs.
  - **Récap** : « Envoyer ce rapport », par `feedback-send.ts`.
  - **Détail d'un morceau** : « Restaurer ce morceau » et le lien de la fiche source, dont les URLs sont fictives.
  - **Contrôles de fenêtre** : masqués en démo, dans la barre d'onglets comme dans celle de l'écran bloquant.
- **Téléphone** : seule `index.demo.html` déclare `width=1280`. Le navigateur d'un téléphone affiche l'app entière réduite, le visiteur zoome puis fait glisser. Un navigateur d'ordinateur ignore cette ligne.
- **Signals** : `.claude/rules/angular/signals.md`. **Routage** inchangé : `.claude/rules/angular/routing.md`. **Thème** inchangé : `.claude/rules/primeng/theming.md`.

## Acceptance criteria

### Scénario 1 : démarrage dans un navigateur nu
**GIVEN** `just dev-demo` et un `src/demo/` généré par le lot 1
**WHEN** le visiteur ouvre la démo avec `?lang=en`
**THEN** l'app s'affiche en anglais sur l'onglet Playlist, le bandeau de démo sous la barre d'onglets
**AND** aucun écran bloquant ne s'affiche, et l'URL ne porte plus `lang`

### Scénario 2 : ordre de la langue
**GIVEN** un choix « Français » enregistré dans les Réglages de la démo
**WHEN** le visiteur revient avec `?lang=en`, puis recharge la page sans paramètre
**THEN** la démo s'ouvre en anglais, puis encore en anglais au rechargement
**AND** sans paramètre ni choix enregistré, la langue suit celle du navigateur

### Scénario 3 : les sélecteurs remplissent les champs
**GIVEN** l'onglet Playlist de la démo
**WHEN** le visiteur clique sur « Choisir » du dossier source, puis de la destination, puis du fichier de playlist
**THEN** chaque champ reçoit le chemin correspondant de `paths` du scénario
**AND** le champ du dossier de l'onglet Tagging reçoit `paths.destination`

### Scénario 4 : actions indisponibles
**GIVEN** la démo ouverte
**WHEN** le visiteur survole « Enregistrer » de la clé API, « Rétablir les valeurs par défaut », « Ouvrir le dossier de logs », « Rechercher une mise à jour », « Vider le cache », « Envoyer ce rapport », « Restaurer ce morceau » ou le lien de la fiche source
**THEN** le contrôle est grisé et le tooltip dit « Indisponible dans la démo. » (« Not available in the demo. » en anglais)
**AND** « Restaurer le dernier run », les runs passés, la langue et le signal sonore restent utilisables

### Scénario 5 : le bandeau mène au contact
**GIVEN** la démo en français
**WHEN** le visiteur clique sur « Me contacter »
**THEN** `https://thibaud-geisler.com/fr/contact` s'ouvre dans un nouvel onglet, `/en/contact` en anglais

### Scénario 6 : le desktop n'embarque pas la démo
**GIVEN** `just build-ui` (desktop)
**WHEN** on inspecte sa sortie
**THEN** elle ne contient ni `app-demo-banner`, ni `scenario.json`, ni le dossier `demo/`
**AND** le job `ui` de la CI fait la même vérification à chaque PR
**AND** dans l'app desktop, les contrôles de fenêtre sont présents, aucun bandeau n'apparaît et aucune action n'est grisée pour cause de démo

### Scénario 7 : rien ne part, rien ne fuit
**GIVEN** `just build-demo`
**WHEN** on inspecte `dist/techno-tagger-ui-demo`
**THEN** aucun fichier `.map` n'est présent, `main.demo.ts` n'appelle pas `Sentry.init` et aucun hôte d'ingestion Sentry n'apparaît dans le bundle
**AND** `index.html` déclare `width=1280` et `noindex`

### Scénario 8 : le scénario arrive avant la première commande
**GIVEN** un `scenario.json` lent à charger
**WHEN** l'app démarre
**THEN** `get_version` reçoit sa réponse après le chargement, jamais une erreur
**AND** sans `scenario.json`, le transport rend `false` et l'écran bloquant s'affiche

## Tests à écrire

### Unit
- `src/app/demo/demo-language.spec.ts` :
  - takes French or English from the query and removes the parameter
  - ignores an unknown language and still removes the parameter
  - returns nothing when the query carries no language
- `src/app/demo/scenario.spec.ts` :
  - parses a scenario of schema version 1
  - rejects an unknown schema version
  - rejects a reply whose outcome or phase is unknown
  - rejects a reply pointing outside the lines table
- `src/app/demo/replay-transport.spec.ts` :
  - answers get_version only once the scenario is loaded, with the app version
  - answers get_interrupted_run with its recorded line
  - reports an unreadable scenario and stays unavailable
  - leaves any other command unanswered
- `src/app/demo/demo-native.service.spec.ts` :
  - picks the scenario path matching each target
  - serves a recorded artwork from the demo assets
- `src/app/demo/demo-preferences.service.spec.ts` :
  - keeps preferences in memory when storage is refused
  - ignores a stored language outside fr and en
- `src/app/demo/demo-banner.component.spec.ts` :
  - points the contact link to the page of the current language
- `src/app/app.component.spec.ts` :
  - hides the window controls in the demo edition
- `src/app/features/settings/settings-page.component.spec.ts` :
  - greys out the API key, thresholds, logs, update check and cache clearing with the demo reason in the demo edition
  - keeps restoring the last run, past runs, language and sound available in the demo edition
  - keeps every action available in the desktop edition
- `src/app/features/tagging/recap/feedback-send.spec.ts` :
  - blocks sending a report with the demo reason in the demo edition
- `src/app/features/tagging/run/track-detail.component.spec.ts` :
  - greys out restoring one track and opening the source page in the demo edition
- `sidecar/tests/unit/test_demo_scenario_mirror.py` :
  - mirrors the scenario fields and literal values of the Python model

Le mapping desktop de `pickPath` (`directory` d'après la cible) n'a pas de test : il tiendrait à un `vi.mock` de `@tauri-apps/plugin-dialog`, que `.claude/rules/angular/tests.md` écarte sous `@angular/build:unit-test`. Il se vérifie à la main sur `just dev`.

## Edge cases

- **`?lang` inconnu** (`de`) : ignoré, paramètre retiré, langue enregistrée puis navigateur.
- **Langue stockée hors liste** (valeur modifiée dans les devtools) : ignorée, comme un `?lang` inconnu.
- **Stockage refusé** (navigation privée) : préférences gardées le temps de la session, aucune erreur visible.
- **Scénario introuvable ou illisible** : `DemoScenarioError` en console, `start()` rend `false`. L'écran bloquant s'affiche, car un build sans `src/demo/` est un défaut de packaging, pas un état normal.
- **Commande hors démarrage** : sans réponse dans ce lot, le lot 3 complète.
- **Fenêtre étroite sur ordinateur** (sous 1024px) : comme le desktop sous son plancher, hors périmètre.

## Architectural decisions

### Décision : comment l'app sait qu'elle tourne en démo

**Options envisagées :**
- **A. Lire `APP_ENVIRONMENT === "demo"` dans les composants** : direct, mais une constante de build dans un composant se teste mal et contourne l'injection.
- **B. Jeton `APP_EDITION`, `"desktop"` par défaut** : fourni par `demoConfig`, injectable et remplaçable dans un test.

**Choix : B**

**Rationale :**
- `.claude/rules/angular/app-config.md` fait passer la configuration applicative par un `InjectionToken` avec factory
- Les specs posent l'édition par un provider, sans `--define`

### Décision : où vit le bandeau

**Options envisagées :**
- **A. `@if` sur l'édition dans `app.component.html`, avec import du composant** : simple, mais AppComponent importe le bandeau et le bundle desktop l'embarque.
- **B. Jeton `APP_BANNER` et `NgComponentOutlet`** : AppComponent ne connaît qu'un emplacement, et `demoConfig` y met le bandeau.

**Choix : B**

**Rationale :**
- Aucun module de démo dans le bundle desktop (scénario 6)

### Décision : distinguer les sélecteurs

**Options envisagées :**
- **A. Deviner d'après l'ordre des appels** : aucun changement côté desktop, mais un visiteur qui choisit la destination avant la source reçoit le mauvais chemin.
- **B. `pickPath(target: PathTarget)`** : chaque appel dit ce qu'il cherche, et le desktop en déduit `directory`.

**Choix : B**

**Rationale :**
- Une union de littéraux plutôt qu'un booléen qui ne dit pas quel champ il remplit
- Trois appelants seulement, sans changement visible sur le desktop

### Décision : configuration `demo` recopiée ou empilée

**Options envisagées :**
- **A. `demo` recopie budgets, `outputHashing` et `optimization` de `production`** : lisible seul, mais trois copies qu'aucun test ne garde.
- **B. `--configuration production,demo`** : Angular fusionne les deux dans l'ordre, `demo` ne porte que ses différences. `define` passe par la ligne de commande, la fusion des configurations étant superficielle.

**Choix : B**

**Rationale :**
- Une valeur, une source : une montée des budgets de `production` vaut pour la démo sans rien toucher
- Aucune copie ne reste : `APP_ENVIRONMENT` passe par `--define`, fusionné clé par clé avec les options

### Décision : où lire `?lang`

**Options envisagées :**
- **A. Un initializer de langue propre à la démo** : doublonne celui d'`app.config.ts`.
- **B. `DemoPreferencesService.readLanguage()`** : l'initializer existant appelle déjà `preferences.readLanguage()` en premier.

**Choix : B**

**Rationale :**
- `app.config.ts` reste inchangé, l'ordre `?lang` puis choix puis navigateur découle de l'ordre existant
