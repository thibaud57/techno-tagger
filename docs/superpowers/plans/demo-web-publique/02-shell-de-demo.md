# Shell de démo : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire l'interface Angular dans une configuration `demo` qui démarre dans un navigateur nu, se présente comme une démo, accueille le visiteur dans sa langue et explique les actions indisponibles.

**Architecture:** Une configuration `demo` d'`angular.json` démarre par `src/main.demo.ts` et sa propre `index.demo.html`. `demoConfig` fusionne `appConfig` avec les remplaçants de démo : transport, natifs, préférences, plateforme, édition et bandeau. Les composants n'apprennent la démo que par le jeton `APP_EDITION`, qui ajoute une raison de blocage là où leur motif « grisé + tooltip » existe déjà.

**Tech Stack:** Angular 22 (standalone, signals, zoneless, Signal Forms), PrimeNG 22, Tailwind 4 + `tailwindcss-primeui`, ngx-translate 18, Vitest via `@angular/build:unit-test`, pytest pour la garde du miroir. Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/demo-web-publique/02-shell-de-demo-design.md`. Modèle du scénario : `docs/superpowers/plans/demo-web-publique/01-enregistreur-de-scenario.md`, Task 3, bloc Interfaces. `src/demo/` existe (lot 1 implémenté avant).

## Global Constraints

- **Aucun module de démo dans le bundle desktop** : le desktop ne connaît que les jetons `APP_EDITION` (`"desktop"` par défaut) et `APP_BANNER` (`null` par défaut).
- **Sortie** `dist/techno-tagger-ui-demo`. La démo est servie à la racine. Elle lit en absolu `/demo/scenario.json` et `/demo/artworks/<référence>.svg`, et `/i18n/` reste inchangé.
- **Clés i18n**, namespace `demo`, dans les deux fichiers et dans le même commit :

  | Clé | Français | Anglais |
  |---|---|---|
  | `demo.banner.text` | « Démo : données fictives, aucun fichier réel. Application privée, non affiliée à Beatport ni Bandcamp. » | « Demo: fictional data, no real files. Private app, not affiliated with Beatport or Bandcamp. » |
  | `demo.banner.contact` | « Me contacter » | « Contact me » |
  | `demo.unavailable` | « Indisponible dans la démo. » | « Not available in the demo. » |

- **Contact** : `https://thibaud-geisler.com/<fr|en>/contact`, nouvel onglet, `rel="noopener noreferrer"`. Seul lien sortant de la démo : `openUrl` et `revealItemInDir` de démo ne font rien.
- **Bandeau B** : `h-8`, `border-b border-surface-800`, `bg-surface-900`, `text-xs text-muted-color`, centré, `app-icon name="info-circle"` à 16, puis le lien `pButton [link]="true"`.
- **`index.demo.html`** : `viewport` à `width=1280`, `<title>Techno Tagger (démo)</title>`, `<meta name="robots" content="noindex">`, le reste identique à `src/index.html`.
- **Configuration `demo` empilée** : build `--configuration production,demo`, serve `development,demo`. La fusion des configurations est superficielle (vérifié le 2026-10-25 dans `@angular-devkit/architect`, `node-modules-architect-host.js`) : `demo.define` reprend les six clés de `build.options.define`.
- **Commandes du démarrage** : `get_version` puis `get_interrupted_run`, les seules que `SidecarService` envoie au lancement. Le transport les sert, le reste attend le lot 3.
- **Scénario chargé par le transport** : `ReplayTransport.start()` attend `DemoScenarioService.load()`. Aucun initializer de chargement : Angular lance tous les initializers d'un coup (`runInitializers`), celui du sidecar enverrait `get_version` avant la fin du `fetch`.
- **Clés i18n `demo.*` dans le desktop** : acceptées, ce sont des textes que rien ne lit hors démo (décision du 2026-10-25). Le code et le scénario de démo, eux, en sont absents, gardé par la CI.
- **TypeScript** : pas d'`enum`, des tableaux `as const` et leur type dérivé. Fonctions en `const nom = (...) =>`. `unknown` réduit par garde (`.claude/rules/typescript/types.md`).
- **Services de démo** en `@Service({ autoProvided: false })`, fournis par `demoConfig` seulement.
- **Tests** : `describe`/`it` en anglais, AAA, stubs de `src/fixtures/` réutilisés (`.claude/rules/angular/tests.md`).
- **Gate vert à chaque commit** : `just lint-ui && just typecheck-ui && just test-ui`, plus `just test-sidecar` pour la Task 2. Commits `feat(demo): …`.

## Review Focus

- **Visiteur arrivé avec `?lang=de`** : la démo ne plante pas, retombe sur le choix enregistré ou le navigateur, et l'URL perd le paramètre (Task 4, `ignores an unknown language and still removes the parameter`).
- **Navigation privée qui refuse `localStorage`** : l'app démarre, la langue choisie tient le temps de la session (Task 4, `keeps preferences in memory when storage is refused`).
- **Lien de contact après un changement de langue dans les Réglages** : il suit la langue courante (Task 5, `points the contact link to the page of the current language`).
- **Scénario lent à charger** : `get_version` attend le scénario au lieu d'échouer (Task 4, `answers get_version only once the scenario is loaded`).
- **Langue stockée falsifiée** : ignorée, comme un `?lang` inconnu (Task 4, `ignores a stored language outside fr and en`).
- **Desktop qui verrait une raison de démo** : sans `APP_EDITION` fourni, aucune action n'est grisée pour cette raison (Task 6, `keeps every action available in the desktop edition`). Le mapping desktop de `pickPath` se vérifie à la main sur `just dev` (Task 3, Step 4) : un `vi.mock` du plugin est écarté par `.claude/rules/angular/tests.md`.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/main.demo.ts`, `src/index.demo.html` | Entrée et page de la démo |
| `src/app/demo/demo.config.ts` | `demoConfig`, seule liste des remplaçants |
| `src/app/core/platform/app-edition.ts` | `AppEdition`, `APP_EDITION`, `APP_BANNER` |
| `src/app/demo/scenario.ts` | Miroir TypeScript du scénario, `parseScenario` |
| `src/app/demo/demo-scenario.service.ts` | Chargement unique de `/demo/scenario.json` |
| `src/app/demo/replay-transport.ts` | Chargement du scénario, réponses du démarrage |
| `src/app/demo/demo-native.service.ts` | Sélecteurs, pochettes, natifs inertes |
| `src/app/demo/demo-preferences.service.ts`, `demo-language.ts` | Préférences dans le navigateur, `?lang` |
| `src/app/demo/demo-platform.ts` | `APP_UPDATER` et `APP_WINDOW` de démo |
| `src/app/demo/demo-banner.component.ts` + `.html` | Bandeau B |
| `src/fixtures/demo-scenario.ts` | `scenarioWith`, constructeur des scénarios de test (lots 2 et 3) |
| `sidecar/tests/helpers/protocol_mirror.py` | Lecture d'un second fichier TypeScript |
| `sidecar/tests/unit/test_demo_scenario_mirror.py` | Garde du miroir |

---

### Task 1: Build de démo

**Files:**
- Create: `src/main.demo.ts`, `src/index.demo.html`, `src/app/demo/demo.config.ts`, `src/app/core/platform/app-edition.ts`
- Modify: `angular.json` (configuration `demo` sous `build.configurations` et `serve.configurations`), `package.json` (scripts), `Justfile` (recettes), `.github/workflows/ci.yml` (job `ui` : garde du bundle desktop), `docs/ARCHITECTURE.md` (arborescence), `.claude/skills/dev-server/SKILL.md` (recette `dev-demo`), `.claude/skills/quality-check/SKILL.md` (recette `build-demo`), `.claude/CLAUDE.md` (table des commandes)

**Interfaces:**
- Produces :
  - `export type AppEdition = "desktop" | "demo"` ;
  - `export const APP_EDITION = new InjectionToken<AppEdition>("AppEdition", { providedIn: "root", factory: () => "desktop" })` ;
  - `export const APP_BANNER = new InjectionToken<Type<unknown> | null>("AppBanner", { providedIn: "root", factory: () => null })` ;
  - `export const demoConfig: ApplicationConfig = mergeApplicationConfig(appConfig, { providers: DEMO_PROVIDERS })`, où `DEMO_PROVIDERS` commence par `{ provide: APP_EDITION, useValue: "demo" }`, `{ provide: ErrorHandler, useClass: ErrorHandler }` et `{ provide: CAPTURE_EXCEPTION, useValue: (exception: unknown) => { console.error(exception); return "" } }`. Les tâches suivantes ajoutent leurs providers à `DEMO_PROVIDERS`.

- [ ] **Step 1: Configuration `demo` dans `angular.json`**

Sous `build.configurations.demo`, seulement ce qui diffère de `production` :
- `browser: "src/main.demo.ts"`, `index: "src/index.demo.html"`, `outputPath: "dist/techno-tagger-ui-demo"`, `sourceMap: false` ;
- `assets: [{ "glob": "**/*", "input": "public" }, { "glob": "**/*", "input": "src/demo", "output": "demo" }]` ;
- `define` complet, les six clés de `build.options.define` recopiées, avec `APP_ENVIRONMENT: "'demo'"` et `SENTRY_DSN_UI: "''"` (le `define` d'une configuration remplace celui de base en bloc).

Sous `serve.configurations.demo` : `buildTarget: "techno-tagger-ui:build:development,demo"`.

- [ ] **Step 2: Scripts et recettes**

`package.json` :
- `"build:demo": "ng build --configuration production,demo --define \"PRIMENG_LICENSE_KEY='$PRIMENG_LICENSE_KEY'\" --define \"APP_VERSION='$npm_package_version'\""`, sans `sourcemaps` ;
- `"start:demo": "ng serve --configuration demo --define …"`, mêmes `--define`.

Charger `Skill[justfile-creator]`, puis `Justfile`, groupe des recettes UI, sur le modèle de `dev-ui` et `build-ui` : `dev-demo` (`pnpm start:demo`) et `build-demo` (`pnpm build:demo`).

- [ ] **Step 3: `app-edition.ts`, `demo.config.ts`, `main.demo.ts`, `index.demo.html`**

`main.demo.ts` : `bootstrapApplication(AppComponent, demoConfig).catch(…)`, sur le modèle de `main.ts`, sans `Sentry.init`.

- [ ] **Step 4: Vérifier les deux builds**

Run: `just build-demo && ls dist/techno-tagger-ui-demo/browser/demo && find dist/techno-tagger-ui-demo -name "*.map" | wc -l && grep -c "width=1280\|noindex" dist/techno-tagger-ui-demo/browser/index.html && ! grep -rlE "ingest\.([a-z]+\.)?sentry\.io" dist/techno-tagger-ui-demo/browser`
Expected: `scenario.json` et `artworks/` listés, `0` fichier `.map`, `2`, aucun hôte d'ingestion Sentry (scénario 7 du spec). Ouvrir `just dev-demo` : aucun `ReferenceError` en console (le `define` est complet).

Run: `just build-ui && test ! -d dist/techno-tagger-ui/browser/demo && ! grep -rl "scenario.json\|app-demo-banner" dist/techno-tagger-ui/browser`
Expected: code de sortie 0 (scénario 6 du spec, pour la partie build).

- [ ] **Step 5: Garde CI du bundle desktop**

Dans `.github/workflows/ci.yml`, job `ui`, juste après `- run: just build-ui`, un step nommé « Garde du bundle desktop » qui lance la seconde commande de la Step 4. Vérifier par `just lint-workflows`.

- [ ] **Step 6: Arborescence d'ARCHITECTURE.md**

Charger `Skill[architecture-doc]`. Ajouter `src/main.demo.ts`, `src/index.demo.html` et `src/app/demo/` (shell de démo, fourni par `demoConfig`) à l'arborescence.

- [ ] **Step 7: Skill `dev-server` et CLAUDE.md du projet**

Par `Skill[skill-creator]`, ajouter au skill `dev-server` la recette `just dev-demo` (démo dans le navigateur, sans Tauri ni sidecar), à côté de `dev`, `dev-ui`, `dev-sidecar` et `stop`. Ajouter au skill `quality-check` `just build-demo` dans sa ligne « Build ». Par `Skill[claude-md-doc]`, ajouter `dev-demo` à la ligne `dev-server` et `build-demo` à la ligne `quality-check` de la table des commandes de `.claude/CLAUDE.md`.

- [ ] **Step 8: Gate and commit**

```bash
git add angular.json package.json Justfile .github/workflows/ci.yml src/main.demo.ts src/index.demo.html src/app/demo/demo.config.ts src/app/core/platform/app-edition.ts docs/ARCHITECTURE.md .claude/skills/dev-server/SKILL.md .claude/skills/quality-check/SKILL.md .claude/CLAUDE.md
git commit -m "feat(demo): configuration de build demo et point d'entree"
```

### Task 2: Miroir du scénario

**Files:**
- Create: `src/app/demo/scenario.ts`, `src/app/demo/scenario.spec.ts`, `src/app/demo/demo-scenario.service.ts`, `src/fixtures/demo-scenario.ts`, `sidecar/tests/unit/test_demo_scenario_mirror.py`
- Modify: `src/app/demo/demo.config.ts` (provider de `DemoScenarioService`), `sidecar/tests/helpers/protocol_mirror.py` (paramètre `source: Path = _PROTOCOL_TS` sur `_source`, `_declared`, `ts_interfaces` et `ts_unions`, cache par chemin : aujourd'hui `_source()` est un `@cache` sans argument)

**Interfaces:**
- Consumes : modèle Python `demo_scenario` (plan 01, Task 3)
- Produces :
  - `OUTCOMES` et `type Outcome`, `PHASES` et `type Phase` (tableaux `as const` aux valeurs des `StrEnum`) ;
  - `type JsonValue`, `type JsonObject` ;
  - interfaces `DemoPaths`, `StatelessReply`, `StatefulReply`, `Scenario` (avec `key_fields: Readonly<Record<string, readonly string[]>>` et `initial_outcomes: Readonly<Record<string, Outcome>>`), champs `readonly` en snake_case identiques au modèle ;
  - `class DemoScenarioError extends Error` ;
  - `const parseScenario = (raw: unknown): Scenario` ;
  - `@Service({ autoProvided: false }) class DemoScenarioService` : `load(): Promise<void>` fait `fetch("/demo/scenario.json")` puis `parseScenario`, une seule fois (promesse mémorisée). `scenario(): Scenario` le rend ensuite de façon synchrone, et lève `DemoScenarioError` avant la fin de `load`. C'est `ReplayTransport.start()` (Task 4) qui attend `load()`, pas un initializer ;
  - `export const scenarioWith = (overrides: Partial<Omit<Scenario, "paths">> & { readonly paths?: Partial<DemoPaths> }): Scenario` dans `src/fixtures/demo-scenario.ts` : schéma 1, chemins `LIB` / `DEST` / `DUMP`, `key_fields` réduite aux commandes des tests, tables vides, `initial_outcomes` vide, le tout surchargé par `overrides`. Les lots 2 et 3 ne construisent aucun scénario de test autrement.

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseScenario", () => {
  it("parses a scenario of schema version 1", () => {
    const raw = { schema_version: 1, paths: { vlc_dump: "a", library: "b", destination: "c" }, key_fields: { get_version: [] }, initial_outcomes: { "a.mp3": "pending" }, lines: [{ event: "version" }], stateless: [{ command: { command: "get_version" }, call: 1, sets: {}, enters: null, lines: [0] }], stateful: [] }

    const scenario = parseScenario(raw)

    expect(scenario.paths.library).toBe("b")
    expect(scenario.initial_outcomes["a.mp3"]).toBe("pending")
  })

  it("rejects an unknown schema version", () => {
    expect(() => parseScenario({ ...scenarioWith({}), schema_version: 2 })).toThrow(DemoScenarioError)
  })

  it("rejects a reply whose outcome or phase is unknown", () => {
    const outcome = { ...scenarioWith({}), initial_outcomes: { "a.mp3": "maybe" } }
    const phase = scenarioWith({ lines: [{ event: "x" }], stateful: [{ command: { command: "list_runs" }, outcomes: {}, phase: "later", sets: {}, enters: null, lines: [0] }] })

    expect(() => parseScenario(outcome)).toThrow(DemoScenarioError)
    expect(() => parseScenario(phase)).toThrow(DemoScenarioError)
  })

  it("rejects a reply pointing outside the lines table", () => {
    const raw = scenarioWith({ lines: [], stateless: [{ command: { command: "get_version" }, call: 1, sets: {}, enters: null, lines: [3] }] })

    expect(() => parseScenario(raw)).toThrow(DemoScenarioError)
  })
})
```

```python
def test_mirrors_the_scenario_fields_and_literal_values_of_the_python_model() -> None:
    interfaces = ts_interfaces(SCENARIO_TS)
    unions = ts_unions(SCENARIO_TS)

    assert interfaces["Scenario"] == frozenset(Scenario.model_fields)
    assert interfaces["StatelessReply"] == frozenset(StatelessReply.model_fields)
    assert interfaces["StatefulReply"] == frozenset(StatefulReply.model_fields)
    assert interfaces["DemoPaths"] == frozenset(DemoPaths.model_fields)
    assert unions["Outcome"] == {o.value for o in Outcome}
    assert unions["Phase"] == {p.value for p in Phase}
```

`SCENARIO_TS = REPO / "src/app/demo/scenario.ts"`, déclaré dans `protocol_mirror.py` à côté de `_PROTOCOL_TS`. `ts_union_members` liste les interfaces d'une union d'interfaces, pas des littéraux : c'est `ts_unions` qui lit un type dérivé d'un tableau `as const`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/scenario.spec.ts` puis `cd sidecar && uv run pytest tests/unit/test_demo_scenario_mirror.py -x -q`
Expected: FAIL (module introuvable, fichier `scenario.ts` absent)

- [ ] **Step 3: Implement `scenario.ts`, `demo-scenario.service.ts`, `scenarioWith`, the `source` parameter of `protocol_mirror.py`**

`parseScenario` vérifie `schema_version === 1`, la forme des `paths`, que `key_fields` est un objet de tableaux de chaînes, que chaque valeur d'`initial_outcomes`, d'`outcomes` et de `sets` est dans `OUTCOMES`, que chaque `phase` et chaque `enters` non nul est dans `PHASES`, que `call` est un entier ≥ 1, et pour chaque réponse que chaque index de `lines` existe. Elle lève `DemoScenarioError` avec le champ en cause. Ajouter `DemoScenarioService` à `DEMO_PROVIDERS`. Dans `protocol_mirror.py`, `_source(source: Path = _PROTOCOL_TS)` et `_declared(source)` gardent `@cache` (un `Path` est hashable), les lecteurs publics propagent `source`.

- [ ] **Step 4: Run the tests**

Mêmes commandes qu'à la Step 2. Expected: PASS. Puis `just test-sidecar`, vert (le paramètre par défaut garde `test_protocol_mirror.py` intact).

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/demo/scenario.ts src/app/demo/scenario.spec.ts src/app/demo/demo-scenario.service.ts src/app/demo/demo.config.ts src/fixtures/demo-scenario.ts sidecar/tests/helpers/protocol_mirror.py sidecar/tests/unit/test_demo_scenario_mirror.py
git commit -m "feat(demo): miroir TypeScript du scenario garde par le sidecar"
```

### Task 3: Sélecteurs par cible et natifs de démo

**Files:**
- Modify: `src/app/core/platform/native.service.ts`, `src/app/features/playlist/playlist-page.component.ts` + `.html` (lignes 64, 74, 84), `src/app/features/tagging/run/tagging-page.component.ts:231`, `src/fixtures/native-stub.ts`, les specs qui appellent `pickPath`
- Create: `src/app/demo/demo-native.service.ts`, `src/app/demo/demo-native.service.spec.ts`

**Interfaces:**
- Consumes : `DemoScenarioService.scenario`, `scenarioWith` (Task 2)
- Produces :
  - `export type PathTarget = "library" | "destination" | "playlist" | "tagging_folder"` dans `native.service.ts` ;
  - `NativeService.pickPath(target: PathTarget): Promise<string | null>`. Le desktop passe `directory: target !== "playlist"` au plugin ;
  - `chooseFolder(target: WritableSignal<string | null>, kind: "library" | "destination")` dans la page Playlist ;
  - `@Service({ autoProvided: false }) class DemoNativeService implements NativeService` : `pickPath` rend le chemin de `paths` (`library` → `library`, `destination` et `tagging_folder` → `destination`, `playlist` → `vlc_dump`), `assetUrl(path)` rend `/demo/${path}`, `openUrl` et `revealItemInDir` rendent une promesse résolue sans rien faire (leurs appelants sont grisés en démo, Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// demo-native.service.spec.ts
it.each([["library", "LIB"], ["destination", "DEST"], ["tagging_folder", "DEST"], ["playlist", "DUMP"]] as const)(
  "picks the scenario path matching the %s target", async (target, expected) => {
    const path = await demoNative.pickPath(target)

    expect(path).toBe(expected)
  })

it("serves a recorded artwork from the demo assets", () => {
  expect(demoNative.assetUrl("artworks/CH012.svg")).toBe("/demo/artworks/CH012.svg")
})
```

Le scénario de test vient d'un `DemoScenarioService` remplacé par `{ scenario: () => scenarioWith({}) }` (chemins par défaut du constructeur). Le mapping desktop (`directory` d'après la cible) n'a pas de spec : il tiendrait à un `vi.mock` de `@tauri-apps/plugin-dialog`, écarté par `.claude/rules/angular/tests.md` sous `@angular/build:unit-test`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/demo-native.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the target refactor, `DemoNativeService`, then provide it in `DEMO_PROVIDERS` (`{ provide: NativeService, useClass: DemoNativeService }`)**

Mettre `nativeStub` à la nouvelle signature et adapter les specs de Playlist et de Tagging qui l'appellent.

- [ ] **Step 4: Run the tests, then the desktop by hand**

Run: `just test-ui`, puis `just dev`.
Expected: PASS, specs de Playlist et de Tagging comprises. Sur le desktop, « Choisir » du dossier source et de la destination ouvre un sélecteur de dossier, celui de la playlist un sélecteur de fichier, et chaque champ reçoit le chemin choisi.

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/core/platform/native.service.ts src/app/features/playlist/playlist-page.component.ts src/app/features/playlist/playlist-page.component.html src/app/features/playlist/playlist-page.component.spec.ts src/app/features/tagging/run/tagging-page.component.ts src/app/features/tagging/run/tagging-page.component.spec.ts src/fixtures/native-stub.ts src/app/demo/demo-native.service.ts src/app/demo/demo-native.service.spec.ts src/app/demo/demo.config.ts
git commit -m "feat(demo): selecteurs par cible et natifs de demo"
```

### Task 4: Transport de démarrage, plateforme, préférences et langue

**Files:**
- Create: `src/app/demo/replay-transport.ts` + spec, `src/app/demo/demo-platform.ts`, `src/app/demo/demo-preferences.service.ts` + spec, `src/app/demo/demo-language.ts` + spec
- Modify: `src/app/demo/demo.config.ts`

**Interfaces:**
- Consumes : `DemoScenarioService`, `Scenario`, `scenarioWith` (`src/fixtures/demo-scenario.ts`, Task 2), `SidecarTransport` et `SidecarHandlers` (`core/sidecar/sidecar-transport.ts`), `AppUpdater`, `AppWindow`, `PreferencesService`, `Language`, `LANGUAGES` et `languageFromTag`
- Produces :
  - `STARTUP_COMMANDS = ["get_version", "get_interrupted_run"] as const` ;
  - `@Service({ autoProvided: false }) class ReplayTransport implements SidecarTransport` : `start(handlers)` garde les handlers, attend `scenarios.load()` et rend `true` ; sur `DemoScenarioError`, écrit `console.error("[demo] scenario illisible", error)` et rend `false`. `send(line)` parse la commande, trouve sa réponse sans état de rang 1 par nom de commande parmi `STARTUP_COMMANDS`, puis émet chaque ligne par `handlers.onLine(JSON.stringify(...))`, la ligne `version` avec `version: APP_VERSION`. Toute autre commande reste sans réponse ;
  - `demoUpdater: AppUpdater` (`check` rend `null`), `demoWindow: AppWindow` (sans effet) ;
  - `const takeLanguageFromQuery = (location: Pick<Location, "search" | "pathname" | "hash">, history: Pick<History, "replaceState">): Language | null` ;
  - `@Service({ autoProvided: false }) class DemoPreferencesService implements PreferencesService`, avec le préfixe `techno-tagger-demo:` dans `localStorage`, une `Map` en mémoire si `localStorage` lève une `DOMException` (toute autre erreur remonte, le pourquoi en commentaire), et `readLanguage()` qui passe par `takeLanguageFromQuery`, enregistre, sinon relit la valeur stockée et la réduit par `languageFromTag` : hors `LANGUAGES`, `null`.
  - Providers ajoutés : `SIDECAR_TRANSPORT` (`useClass: ReplayTransport`), `APP_UPDATER` (`useValue: demoUpdater`), `APP_WINDOW` (`useValue: demoWindow`), `PreferencesService` (`useClass: DemoPreferencesService`).

- [ ] **Step 1: Write the failing tests**

```ts
// demo-language.spec.ts
it.each(["fr", "en"] as const)("takes %s from the query and removes the parameter", (lang) => {
  const replaceState = vi.fn()

  const taken = takeLanguageFromQuery({ search: `?lang=${lang}&x=1`, pathname: "/playlist", hash: "" }, { replaceState })

  expect(taken).toBe(lang)
  expect(replaceState).toHaveBeenCalledWith(null, "", "/playlist?x=1")
})

it("ignores an unknown language and still removes the parameter", () => { ... })   // "?lang=de" -> null, replaceState("/playlist")
it("returns nothing when the query carries no language", () => { ... })          // "" -> null, replaceState non appele

// demo-preferences.service.spec.ts
it("keeps preferences in memory when storage is refused", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("denied") })

  await preferences.writeLanguage("en")

  expect(await preferences.readLanguage()).toBe("en")
})

it("ignores a stored language outside fr and en", async () => {
  localStorage.setItem("techno-tagger-demo:language", "xx")

  const language = await preferences.readLanguage()

  expect(language).toBeNull()
})

// replay-transport.spec.ts
it("answers get_version only once the scenario is loaded, with the app version", async () => {
  const { promise, resolve } = Promise.withResolvers<void>()
  scenarios.load.mockReturnValue(promise)

  const started = transport.start(handlers)
  resolve()
  await started
  await transport.send(line({ command: "get_version" }))

  expect(onLine).toHaveBeenCalledWith(expect.stringContaining(`"version":"${APP_VERSION}"`))
})

it("reports an unreadable scenario and stays unavailable", async () => {
  scenarios.load.mockRejectedValue(new DemoScenarioError("schema_version"))
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

  const available = await transport.start(handlers)

  expect(available).toBe(false)
  expect(error).toHaveBeenCalled()
})

it("answers get_interrupted_run with its recorded line", async () => { ... })     // onLine reçoit la ligne de rang 1
it("leaves any other command unanswered", async () => { ... })                    // list_runs -> onLine jamais appele
```

`scenarios` est un double de `DemoScenarioService` (`load: vi.fn()`, `scenario: () => scenarioWith({...})` avec les deux réponses sans état) fourni par `{ provide: DemoScenarioService, useValue: scenarios }`. `line()` et `handlers` viennent de `src/fixtures/sidecar-stub.ts` s'ils y sont, sinon locaux.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/*.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the four files, then add their providers to `DEMO_PROVIDERS`**

- [ ] **Step 4: Run the tests, then the startup by hand**

Run: `just test-ui`, puis `just dev-demo` et ouvrir `http://localhost:4200/?lang=en`.
Expected: tests verts. L'app s'ouvre en anglais sur Playlist, sans écran bloquant, l'URL sans `lang`, et « Choisir » remplit les champs. Les Réglages s'ouvrent, l'historique et la taille du cache restent en chargement jusqu'au lot 3.

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/demo
git commit -m "feat(demo): demarrage, preferences et langue de la demo"
```

### Task 5: Bandeau et contrôles de fenêtre

**Files:**
- Create: `src/app/demo/demo-banner.component.ts` + `.html` + spec
- Modify: `src/app/app.component.ts` + `.html` + `.spec.ts` (outlet entre `</p-tabs>` et `<main>`, contrôles de fenêtre lignes 21 et 80), `public/i18n/fr.json`, `public/i18n/en.json` (`demo.banner.*`), `src/app/demo/demo.config.ts` (`{ provide: APP_BANNER, useValue: DemoBannerComponent }`), `docs/DESIGN.md`, `.design-sync/NOTES.md`

**Interfaces:**
- Consumes : `APP_EDITION`, `APP_BANNER`, `languageFromTag`, `TranslateService.currentLang()`
- Produces :
  - `DemoBannerComponent`, sélecteur `app-demo-banner`, avec `protected readonly contactUrl = computed(() => \`https://thibaud-geisler.com/${languageFromTag(this.translate.currentLang())}/contact\`)` ;
  - constante `DEMO_CONTACT_ORIGIN = "https://thibaud-geisler.com"` dans le même fichier.

- [ ] **Step 1: Write the failing test**

```ts
it.each([["fr", "https://thibaud-geisler.com/fr/contact"], ["en", "https://thibaud-geisler.com/en/contact"]])(
  "points the contact link to the page of the current language", async (lang, url) => {
    await firstValueFrom(translate.use(lang))
    fixture.detectChanges()

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector("a[data-action=contact]")

    expect(link.href).toBe(url)
    expect(link.rel).toBe("noopener noreferrer")   // le seul lien sortant de la demo : il ne transmet rien
  })

// app.component.spec.ts, avec { provide: APP_EDITION, useValue: "demo" }
it("hides the window controls in the demo edition", () => { ... })   // aucun <app-window-controls> dans le DOM
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/demo-banner.component.spec.ts --include=src/app/app.component.spec.ts`
Expected: FAIL sur les deux nouveaux tests

- [ ] **Step 3: Implement the banner, the outlet, the hidden window controls, the i18n keys**

- `app.component.html` : `@if (banner; as component) { <ng-container *ngComponentOutlet="component" /> }`, `banner = inject(APP_BANNER)` dans `app.component.ts` ;
- les deux `<app-window-controls>` passent sous `@if (edition !== "demo")` ;
- textes FR et EN des Global Constraints, espace insécable avant `:` en français.

- [ ] **Step 4: Run the tests and look at the render**

Run: `just test-ui`, puis `just dev-demo`, puis `just build-ui && ! grep -rl "app-demo-banner" dist/techno-tagger-ui/browser`.
Expected: tests verts. Le bandeau sous la barre d'onglets, sur une seule ligne à 1024px de large en FR comme en EN, sans boutons de fenêtre. La table du run rétrécit de 32px et la page ne défile pas. Le bundle desktop ne contient pas le bandeau (scénario 6 du spec).

- [ ] **Step 5: DESIGN.md et NOTES.md**

Charger `Skill[design-doc]`. Dans § Mapping Composants, ajouter une ligne « Bandeau de démo » : motif B, classes des Global Constraints, liens `link` qu'il porte (contact ; le lot 3 ajoute le redémarrage et met la ligne à jour), raison de l'écart (il parle de l'environnement, pas de l'app, et ne se confond avec aucun `Message`), décision du 2026-10-25, page d'options `docs/superpowers/specs/demo-web-publique/02-bandeau-options.html`. Dans § Layout, ajouter le rendu téléphone de la démo (page déclarée à 1280px, `index.demo.html` seulement, page d'options `02-telephone-options.html`) et les contrôles de fenêtre masqués en démo. Dans `.design-sync/NOTES.md` § Reste ouvert : bandeau de démo absent de la maquette.

- [ ] **Step 6: Gate and commit**

```bash
git add src/app/demo src/app/app.component.ts src/app/app.component.html src/app/app.component.spec.ts public/i18n docs/DESIGN.md .design-sync/NOTES.md
git commit -m "feat(demo): bandeau de demo et controles de fenetre masques"
```

### Task 6: Actions indisponibles dans la démo

**Files:**
- Modify: `src/app/features/settings/settings-page.component.ts` + `.html` + spec, `src/app/features/tagging/recap/feedback-send.ts` + spec, `src/app/features/tagging/run/track-detail.component.ts` + `.html` + spec, `public/i18n/fr.json`, `public/i18n/en.json` (`demo.unavailable`)

**Interfaces:**
- Consumes : `APP_EDITION`, `TOOLTIP` (`src/app/shared/utils/tooltip.ts`)
- Produces : dans chaque composant, `private readonly edition = inject(APP_EDITION)`. En démo, la raison de blocage vaut `"demo.unavailable"` avant toute autre.

Points de branchement :
- **Réglages** :
  - `disabled(path.apiKey, { when: () => demo })` ;
  - `canSave` faux en démo, raison en tooltip sur « Enregistrer » ;
  - `disabled(path.floor/ceiling, { when: () => unknown() || demo })`, raison sur `reset-thresholds` ;
  - raisons de démo en tête de `logsBlockedReason` et de `cacheBlockedReason` ;
  - `check-update` reçoit `[disabled]` et `[pTooltip]` sur le motif `@let … | translate` de `settings-page.component.html:169-182`.
- **Récap** : `demo.unavailable` en tête de `blockedReason` dans `injectFeedbackSend`.
- **Détail d'un morceau** : `restore-track` et `open-source` grisés en démo, tooltip `demo.unavailable` par `[tooltipOptions]="tooltip"`.

- [ ] **Step 1: Write the failing tests**

```ts
// settings-page.component.spec.ts : mountWith reçoit une édition, fournie par { provide: APP_EDITION, useValue: edition }
it("greys out the API key, thresholds, logs, update check and cache clearing with the demo reason in the demo edition", () => {
  const { fixture } = mountWith({}, "api", { edition: "demo" })

  const blocked = ["save-api-key", "reset-thresholds", "reveal-logs", "check-update", "clear-cache"]
    .map((action) => buttonOf(fixture, action))   // en ouvrant chaque section, cf. openSection

  expect(blocked.every((button) => button.disabled)).toBe(true)
  expect(tooltipsOf(blocked)).toEqual(Array(5).fill("demo.unavailable"))
})

it("keeps restoring the last run, past runs, language and sound available in the demo edition", () => { ... })
  // edition "demo" : restore-last-run et les entrees de runs passes non disabled, select de langue et bascule du son actifs,
  // aucun tooltip demo.unavailable sur eux ; changer la langue dans le select traduit la page
it("keeps every action available in the desktop edition", () => { ... })   // sans provider APP_EDITION : aucune raison demo.unavailable

// feedback-send.spec.ts
it("blocks sending a report with the demo reason in the demo edition", () => { ... })   // blockedReason() === "demo.unavailable"

// track-detail.component.spec.ts
it("greys out restoring one track and opening the source page in the demo edition", () => { ... })
```

Si le bouton « Enregistrer » de la clé API n'a pas encore de `data-action`, lui donner `data-action="save-api-key"`. `buttonOf` et `tooltipsOf` restent locaux à la spec des Réglages, sauf si un helper de `src/fixtures/dom.ts` fait déjà le travail.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/features/settings/settings-page.component.spec.ts --include=src/app/features/tagging/recap/feedback-send.spec.ts --include=src/app/features/tagging/run/track-detail.component.spec.ts`
Expected: FAIL sur les nouveaux tests seulement

- [ ] **Step 3: Implement the demo reasons and the `demo.unavailable` key**

- [ ] **Step 4: Run the tests and check by hand**

Run: `just test-ui`, puis `just dev-demo`.
Expected: tests verts. Au survol, chaque action du scénario 4 du spec affiche « Indisponible dans la démo. », et les actions restées libres répondent.

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/features/settings/settings-page.component.ts src/app/features/settings/settings-page.component.html src/app/features/settings/settings-page.component.spec.ts src/app/features/tagging/recap/feedback-send.ts src/app/features/tagging/recap/feedback-send.spec.ts src/app/features/tagging/run/track-detail.component.ts src/app/features/tagging/run/track-detail.component.html src/app/features/tagging/run/track-detail.component.spec.ts public/i18n/fr.json public/i18n/en.json
git commit -m "feat(demo): actions indisponibles dans la demo"
```
