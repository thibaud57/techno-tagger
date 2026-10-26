# Rejeu du scénario : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rejouer le scénario enregistré pour que chaque action du visiteur reçoive la réponse produite par le vrai sidecar, du choix de la playlist à la restauration du run.

**Architecture:** `replay.ts` porte des fonctions pures : la clé d'une commande, le choix d'une réponse et l'état suivant. `ReplayTransport` les applique, tient l'état en signals et programme l'émission des lignes, toujours en différé, au rythme des phases longues. Les actions non enregistrées sont grisées en amont par `APP_EDITION` : interruption, second tagging, URL d'un morceau refusé. Un jeton pré-remplit l'URL de « Lowlands ».

**Tech Stack:** Angular 22 (signals, zoneless), ngx-translate 18, Vitest via `@angular/build:unit-test` (`vi.useFakeTimers`). Aucune dépendance nouvelle.

**Spec:** `docs/superpowers/specs/demo-web-publique/03-rejeu-du-scenario-design.md`. Modèle du scénario : `docs/superpowers/plans/demo-web-publique/01-enregistreur-de-scenario.md`, Task 3 (`key_fields`, `initial_outcomes`, `call`, `sets`, `enters`, phases dont `idle`). Miroir, `scenarioWith` et services de démo : `docs/superpowers/plans/demo-web-publique/02-shell-de-demo.md`.

## Global Constraints

- **Clés de recherche** : `scenario.key_fields` (lot 1, seule source), jamais recopiée en TypeScript. `commandKey(command, keyFields)` sérialise `{ command, ...champs listés }` aux clés triées, un champ absent valant `null`, comme `command_key` côté Python.
- **Choix d'une réponse** :
  - d'abord avec état, en égalité exacte de `outcomes` et `phase` ;
  - puis sans état, au rang `calls[clé] + 1`, ou au dernier rang enregistré au-delà ;
  - `calls` n'avance que sur une réponse sans état.
- **État de départ** : `outcomes = scenario.initial_outcomes`, `phase = "idle"`, `calls = {}`. Un choix applique `sets` puis `enters` avant l'émission.
- **Rythme** :
  - `DEMO_LINE_DELAY_MS = 200` : la ligne d'index `i` (à partir de 0) d'une commande longue part à `i × 200` ms après `send` : `extract_playlist`, `start_tagging`, `commit_run`, `retry_write`, `rollback`, `resolve_by_url` ;
  - les autres réponses partent au tour suivant de la boucle (`setTimeout` 0) ;
  - aucune ligne n'est émise pendant `send`.
- **Commande non enregistrée** : `console.error("[demo] commande hors scenario", clé)`, aucune réponse.
- **Clé i18n** `demo.banner.restart` : « Recommencer la démo », « Restart the demo ». La raison `demo.unavailable` existe déjà (lot 2).
- **TypeScript** : pas d'`enum`, fonctions en `const`, `unknown` réduit par garde, `never` dans le `default` (`.claude/rules/typescript/types.md`).
- **Gate vert à chaque commit** : `just lint-ui && just typecheck-ui && just test-ui`. Commits `feat(demo): …`.

## Review Focus

- **Visiteur qui clique « Extraire » trois fois** : la troisième reçoit la réponse du rang 2, sans console d'erreur (Task 1, `answers the n-th identical command with the reply of its rank, then keeps the last one`).
- **Arbitrage tranché pendant la phase réseau** : sa réponse arrive tout de suite, sans attendre la fin des lignes du tagging (Task 2, `interleaves a reply requested during a long phase in order`).
- **`list_runs` envoyé par l'interface dès `run_finished` de l'écriture** : il reçoit la réponse de la nouvelle phase (Task 1, `applies the outcome and the phase a reply carries before its lines are sent` ; Task 2, `answers a query sent during an emission with the new phase`).
- **Morceau refusé puis ouvert dans le rattrapage** : « Résoudre » grisé avec sa raison, au lieu d'un bouton qui ne répond pas (Task 3, `greys out resolving a track without recorded URL in the demo edition`).
- **Combinaison enregistrée mais injouable** (une réponse avec état manquante pour un chemin que le visiteur peut prendre) : le test sur le vrai scénario la nomme avant la mise en ligne (Task 1, `replays every recorded combination from the initial state to its rollback`).
- **Desktop après ces retouches** : rattrapage libre, interruption et nouveau lancement actifs (Task 3 et Task 4, cas `desktop`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/demo/replay.ts` | Fonctions pures du rejeu |
| `src/app/demo/replay-scenario.spec.ts` | Rejeu de chaque combinaison sur le vrai `src/demo/scenario.json` |
| `src/app/demo/replay-transport.ts` | État, file et rythme d'émission |
| `src/app/features/tagging/url-recovery/recovery-url-hint.ts` | Jeton de l'URL pré-remplie |
| `src/fixtures/demo-scenario.ts` | `scenarioWith` (lot 2), défauts étendus au besoin |

---

### Task 1: Fonctions pures du rejeu

**Files:**
- Create: `src/app/demo/replay.ts`, `src/app/demo/replay.spec.ts`, `src/app/demo/replay-scenario.spec.ts`
- Modify: `src/fixtures/demo-scenario.ts` (défauts de `scenarioWith` si un test le demande), `tsconfig.spec.json` (`resolveJsonModule: true` si absent)

**Interfaces:**
- Consumes : `Scenario`, `StatelessReply`, `StatefulReply`, `Outcome`, `Phase`, `JsonObject` (`src/app/demo/scenario.ts`) ; `scenarioWith` (`src/fixtures/demo-scenario.ts`, lot 2)
- Produces :
  - `export type CommandKey = string & { readonly __brand: "CommandKey" }` ;
  - `export interface ReplayState { readonly outcomes: Readonly<Record<string, Outcome>>; readonly phase: Phase; readonly calls: Readonly<Record<CommandKey, number>> }` ;
  - `export const initialReplayState = (scenario: Scenario): ReplayState` : `initial_outcomes`, phase `idle`, `calls` vide ;
  - `export const commandKey = (command: JsonObject, keyFields: Scenario["key_fields"]): CommandKey` : nom de la commande et ses champs listés, sérialisés aux clés triées, champ absent écrit `null` ;
  - `export interface Choice { readonly reply: StatelessReply | StatefulReply; readonly next: ReplayState }` ;
  - `export const choose = (scenario: Scenario, state: ReplayState, command: JsonObject): Choice | null` ;
  - `export const recoveryUrlOf = (scenario: Scenario, trackId: string): string | null` : `url` d'une réponse `resolve_by_url` du morceau.

- [ ] **Step 1: Write the failing tests** (`replay.spec.ts`)

```ts
const TEST_KEY_FIELDS = scenarioWith({}).key_fields   // la table des tests vit dans la fixture, jamais dans src/app

it("keys a command on the fields the scenario names, whatever the optional fields", () => {
  const recorded = { command: "start_tagging", folder: "C:\\Users\\Demo\\Musique\\Extraction" }
  const sent = { ...recorded, thresholds: { floor: 70, ceiling: 90 } }

  expect(commandKey(sent, TEST_KEY_FIELDS)).toBe(commandKey(recorded, TEST_KEY_FIELDS))
  expect(commandKey({ command: "extract_playlist", mode: "copy", playlist_name: null }, TEST_KEY_FIELDS)).not.toBe(commandKey({ command: "extract_playlist", mode: "move", playlist_name: null }, TEST_KEY_FIELDS))
})

it("treats a missing key field as null", () => {
  expect(commandKey({ command: "rollback", run_id: "de0002" }, TEST_KEY_FIELDS)).toBe(commandKey({ command: "rollback", run_id: "de0002", track_id: null }, TEST_KEY_FIELDS))
})

it("answers the n-th identical command with the reply of its rank, then keeps the last one", () => {
  const scenario = scenarioWith({ lines: [L0, L1], stateless: [reply("extract_playlist", { mode: "copy", playlist_name: null }, 1, [0]), reply("extract_playlist", { mode: "copy", playlist_name: null }, 2, [1])] })
  const extract = { command: "extract_playlist", mode: "copy", playlist_name: null }

  const first = chosen(scenario, initialReplayState(scenario), extract)
  const second = chosen(scenario, first.next, extract)
  const third = chosen(scenario, second.next, extract)

  expect([first, second, third].map((c) => c.reply.lines)).toEqual([[0], [1], [1]])
})

it("prefers the stateful reply matching the current outcomes and phase", () => { ... })
  // un stateful commit_run aux outcomes de départ et un autre aux outcomes modifiés : seul le premier sort en état initial
it("advances the rank only when a stateless reply serves", () => { ... })
  // extract_playlist (sans état) : calls[clé] passe à 1 ; get_rollback_target (avec état, idle) : calls inchangé
it("applies the outcome and the phase a reply carries before its lines are sent", () => { ... })
  // reply.sets { "sub rosa.mp3": "first_beatport" }, reply.enters "write_failed" -> next.outcomes et next.phase mis à jour
it("returns nothing for an unrecorded command", () => { ... })   // cancel_run -> null
```

`reply(command, fields, call, lines)` et `chosen(...)` (appelle `choose` et lève si `null`, sans assertion non nulle) sont des helpers locaux à la spec. `L0` et `L1` sont deux lignes minimales. Les défauts de `key_fields` dans `scenarioWith` (lot 2) couvrent `start_tagging`, `extract_playlist`, `rollback`, `commit_run`, `get_rollback_target` et `cancel_run` : les étendre dans la fixture si un test en demande plus.

Puis `replay-scenario.spec.ts`, sur le vrai scénario (`import scenario from "../../demo/scenario.json"`, parsé par `parseScenario`) :

```ts
it.each(combinations(parsed))("replays every recorded combination from the initial state to its rollback (%s)", (_, commit) => { ... })
  // combinations() : une entrée par StatefulReply commit_run, nommée par ses outcomes ;
  // pour chaque entrée : depuis initialReplayState, chosen() sur get_version, get_interrupted_run, list_runs, get_rollback_target, get_cache_size,
  // puis les deux extract_playlist (rang 1 et 2), puis start_tagging (la commande enregistrée), puis les trois requêtes des Réglages ;
  // puis, pour chaque morceau dont commit.outcomes diffère de l'état courant, la réponse avec état (resolve_arbitration ou resolve_by_url)
  // de l'état courant dont sets donne cette issue, prise dans le scénario, suivie des trois requêtes ;
  // puis commit_run, puis les deux branches à partir de cet état : retry_write puis rollback, et rollback seul ;
  // assertions : chosen() ne lève jamais, la phase finale est rolled_back_after_retry ou rolled_back_without_retry,
  // et le nombre d'entrées vaut 32 (une par combinaison, relevé du lot 1)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/replay.spec.ts --include=src/app/demo/replay-scenario.spec.ts`
Expected: FAIL, module introuvable

- [ ] **Step 3: Implement `replay.ts`**

`choose` calcule la clé de la commande reçue avec `scenario.key_fields` et compare à `commandKey(reply.command, scenario.key_fields)` de chaque réponse. Si `tsconfig.spec.json` n'a pas `resolveJsonModule`, l'ajouter pour l'import du scénario dans le test.

- [ ] **Step 4: Run the tests**

Même commande. Expected: PASS, 32 rejeux verts.

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/demo/replay.ts src/app/demo/replay.spec.ts src/app/demo/replay-scenario.spec.ts
# plus src/fixtures/demo-scenario.ts et tsconfig.spec.json s'ils ont ete modifies
git commit -m "feat(demo): choix des reponses du rejeu par cle, etat et rang"
```

### Task 2: Transport complet

**Files:**
- Modify: `src/app/demo/replay-transport.ts`, `src/app/demo/replay-transport.spec.ts`

**Interfaces:**
- Consumes : `choose`, `initialReplayState`, `commandKey`, `ReplayState` (Task 1) ; `DemoScenarioService.scenario()` (lot 2) ; `APP_VERSION` ; `SidecarCommand` (`protocol.ts`)
- Produces :
  - `export const DEMO_LINE_DELAY_MS = 200` ;
  - `export const LONG_PHASE_COMMANDS = ["extract_playlist", "start_tagging", "commit_run", "retry_write", "rollback", "resolve_by_url"] as const satisfies readonly SidecarCommand["command"][]`.
  - `ReplayTransport` garde son API (`start`, qui attend toujours `load()`, et `send`).
  - Les réponses du démarrage passent désormais par `choose`, sans cas particulier (`STARTUP_COMMANDS` du lot 2 disparaît). La réécriture de `version` en `APP_VERSION` reste.

- [ ] **Step 1: Write the failing tests** (`vi.useFakeTimers()`, scénario par `scenarioWith`)

```ts
it("emits nothing while send runs", async () => {
  await transport.send(line({ command: "list_runs" }))

  expect(onLine).not.toHaveBeenCalled()
})

it("emits a query's line on the next tick", async () => {
  await transport.send(line({ command: "list_runs" }))

  vi.advanceTimersByTime(0)

  expect(onLine).toHaveBeenCalledTimes(1)
})

it("spaces the lines of a long phase and answers a query at once", async () => { ... })
  // start_tagging à 3 lignes : ligne 0 à 0 ms (tour suivant), ligne 1 à 200 ms, ligne 2 à 400 ms ; list_runs : sa ligne à 0 ms

it("interleaves a reply requested during a long phase in order", async () => { ... })
  // start_tagging (3 lignes), à 250 ms resolve_arbitration : sa ligne sort après la ligne 1 (200 ms) et avant la ligne 2 (400 ms)

it("answers a query sent during an emission with the new phase", async () => { ... })
  // commit_run enters write_failed ; list_runs envoyé après la 1re ligne reçoit la réponse stateful en write_failed

it("reports an unrecorded command in the console without answering", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

  await transport.send(line({ command: "cancel_run" }))
  vi.runAllTimers()

  expect(onLine).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledWith("[demo] commande hors scenario", expect.stringContaining("cancel_run"))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/demo/replay-transport.spec.ts`
Expected: FAIL sur les nouveaux tests

- [ ] **Step 3: Implement**

`send` parse la ligne (`unknown` puis garde `JsonObject`), appelle `choose`, pose l'état suivant dans un signal privé, puis programme chaque ligne par `setTimeout` à `index × DEMO_LINE_DELAY_MS` (`index` à partir de 0) pour une commande longue, à 0 sinon. Le `setTimeout` est calculé depuis l'instant du `send`. Deux réponses programmées indépendamment s'intercalent ainsi par leurs échéances.

- [ ] **Step 4: Run the tests**

Même commande, puis `just test-ui`. Expected: PASS

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/demo/replay-transport.ts src/app/demo/replay-transport.spec.ts
git commit -m "feat(demo): rejeu complet du scenario au rythme des phases longues"
```

### Task 3: Rattrapage pré-rempli

**Files:**
- Create: `src/app/features/tagging/url-recovery/recovery-url-hint.ts`
- Modify:
  - `src/app/features/tagging/url-recovery/recovery-ui.store.ts:71-100` + spec ;
  - `src/app/features/tagging/url-recovery/url-link-form.component.html:20-34` (lecture seule) ;
  - `src/app/features/tagging/url-recovery/url-link-actions.component.ts` + `.html` (raison sur `resolve-url`) ;
  - `src/app/demo/demo.config.ts`.

**Interfaces:**
- Consumes : `recoveryUrlOf` (Task 1), `DemoScenarioService`, `APP_EDITION`, `TOOLTIP`
- Produces :
  - `export const RECOVERY_URL_HINT = new InjectionToken<(trackId: string) => string | null>("RecoveryUrlHint", { providedIn: "root", factory: () => () => null })` ;
  - `RecoveryUiStore.draft(trackId)` rend le brouillon, sinon `hint(trackId) ?? ""` ;
  - `RecoveryUiStore.locked(trackId: string): boolean`, vrai en démo quand un indice existe ;
  - `RecoveryUiStore.resolveBlocked(trackId: string): string | null`, qui vaut `"demo.unavailable"` en démo sans indice. `canResolve` devient faux dans ce cas ;
  - provider de démo : `{ provide: RECOVERY_URL_HINT, useFactory: () => { const scenarios = inject(DemoScenarioService); return (trackId: string) => recoveryUrlOf(scenarios.scenario(), trackId) } }`. `scenario()` se lit à l'appel, jamais à l'injection : le scénario est chargé par `ReplayTransport.start()`, et le store peut être construit avant.

- [ ] **Step 1: Write the failing tests** (`recovery-ui.store.spec.ts`)

```ts
it("prefills and locks a recorded recovery URL in the demo edition", () => {
  const store = storeWith({ edition: "demo", hint: (id) => (id === LOWLANDS ? LOWLANDS_URL : null) })

  expect(store.draft(LOWLANDS)).toBe(LOWLANDS_URL)
  expect(store.locked(LOWLANDS)).toBe(true)
  expect(store.canResolve(LOWLANDS)).toBe(true)
})

it("greys out resolving a track without recorded URL in the demo edition", () => {
  const store = storeWith({ edition: "demo", hint: () => null })

  expect(store.canResolve(REFUSED)).toBe(false)
  expect(store.resolveBlocked(REFUSED)).toBe("demo.unavailable")
})

it("keeps recovery free in the desktop edition", () => { ... })   // sans provider : draft "", locked false, resolveBlocked null
```

`storeWith` monte le store avec `sidecarStub` (morceaux rattrapables : `LOWLANDS` et `REFUSED`, valeurs locales à la spec), `APP_EDITION` et `RECOVERY_URL_HINT`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/url-recovery/recovery-ui.store.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement the token, the store changes, the read-only field, the tooltip, the demo provider**

Le champ : `[readOnly]="shown.busy || shown.locked"`. Le bouton « Résoudre » : `@let blocked = resolveBlocked ? (resolveBlocked | translate) : undefined`, `[pTooltip]="blocked"`, `[tooltipOptions]="tooltip"`.

- [ ] **Step 4: Run the tests**

Run: `just test-ui`
Expected: PASS, specs existantes du rattrapage comprises

- [ ] **Step 5: Gate and commit**

```bash
git add src/app/features/tagging/url-recovery src/app/demo/demo.config.ts
git commit -m "feat(demo): rattrapage pre-rempli et URL indisponible en demo"
```

### Task 4: Un seul run, puis recommencer

**Files:**
- Modify:
  - `src/app/features/tagging/run/tagging-page.component.ts:112-203` + spec ;
  - `src/app/demo/demo-banner.component.ts` + `.html` + spec ;
  - `public/i18n/fr.json`, `public/i18n/en.json` ;
  - `docs/DESIGN.md` (ligne « Bandeau de démo » du Mapping, états du rattrapage en démo).

**Interfaces:**
- Consumes : `APP_EDITION`, `SidecarService.taggingRunId()`
- Produces :
  - En démo, `blockedReason` de la page Tagging rend `"demo.unavailable"` en premier pour la seule action `start`, dès que `taggingRunId() !== null` ; `commit` et `retry` gardent leurs raisons. L'entrée `cancel` d'`actionButton` reçoit `blocked: "demo.unavailable"`.
  - Dans `demo-banner.component.ts` : `export const DEMO_RELOAD = new InjectionToken<() => void>("DemoReload", { providedIn: "root", factory: () => () => location.assign("/") })`.
  - Bouton `link` `data-action="restart"` après « Me contacter », qui appelle `DEMO_RELOAD`.

- [ ] **Step 1: Write the failing tests**

```ts
// tagging-page.component.spec.ts
it("greys out interrupting and a second launch in the demo edition", () => { ... })
  // édition demo, run en recherche : action cancel bloquée par demo.unavailable ;
  // run écrit (taggingRunId non nul) : action start bloquée par demo.unavailable
it("keeps interrupting and launching again in the desktop edition", () => { ... })

// demo-banner.component.spec.ts
it("restarts the demo from its home page", () => {
  const reload = vi.fn()
  mountBanner({ reload })

  fixture.nativeElement.querySelector("[data-action=restart]").click()

  expect(reload).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec ng test --watch=false --include=src/app/features/tagging/run/tagging-page.component.spec.ts --include=src/app/demo/demo-banner.component.spec.ts`
Expected: FAIL sur les nouveaux tests

- [ ] **Step 3: Implement the reasons, the restart link and the i18n key**

- [ ] **Step 4: Run the tests and play the whole path**

Run: `just test-ui`, puis `just dev-demo` et jouer le parcours du scénario 1 du spec : playlist, extraction, tagging, deux arbitrages dont un retour à Beatport, rattrapage de « Lowlands », écriture, relance, récap, restauration, puis « Recommencer la démo ». Rejouer une seconde fois en ouvrant les Réglages au milieu des arbitrages et en restaurant sans relancer.
Expected: tests verts. Chaque étape répond, aucune ligne `[demo] commande hors scenario` en console, la progression avance ligne à ligne, et la démo repart sur Playlist dans la langue choisie.

- [ ] **Step 5: DESIGN.md**

Charger `Skill[design-doc]`. Mettre à jour la ligne « Bandeau de démo » du § Mapping (deux liens `link` : contact, redémarrage) et ajouter, à la rubrique du rattrapage, les deux états propres à la démo : champ d'URL en lecture seule quand l'indice existe, « Résoudre » grisé avec `demo.unavailable` sinon (décision du 2026-10-25).

- [ ] **Step 6: Gate and commit**

```bash
git add src/app/features/tagging/run src/app/demo public/i18n docs/DESIGN.md
git commit -m "feat(demo): un seul run par visite et recommencer la demo"
```
