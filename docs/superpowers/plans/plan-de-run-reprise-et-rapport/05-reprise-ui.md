# Invite de reprise d'un run interrompu : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proposer au lancement de reprendre ou d'abandonner un run interrompu et réduire la confirmation de sortie à ce qui perd encore quelque chose.

**Architecture:**
- **`ResumeStore`** porte le run annoncé.
- **`SidecarService`** demande `get_interrupted_run` après une version concordante, route `interrupted_run` et expose `resume`, `discard` et `dismissInterruptedRun`. `resume_run` entre dans la table `launches` comme `start_tagging` et la remise à zéro du lancement est extraite dans `prepareRun`.
- **`ResumeDialogComponent`**, monté et différé dans le shell, rend les trois états (run reprenable, dossier introuvable, plan illisible ou corrompu) et navigue vers `/tagging` à la reprise. La page Tagging suit `requestedFolder()` et affiche le refus de `resume_run` ou de `discard_run`.
- **`CloseGuard`** perd les cas `tagging`, `arbitration` et `unwritten`, que le plan persisté rend à la reprise.

**Tech Stack:** Angular 22 (signals, `@Service()`), PrimeNG 22 `p-dialog`, Tailwind 4 + `tailwindcss-primeui`, ngx-translate 18, Vitest. Helpers `src/fixtures/dialog.ts` (`page`, `action`), `FakeTransport` de `sidecar.service.spec.ts`.

**Spec:** `docs/superpowers/specs/plan-de-run-reprise-et-rapport/05-reprise-ui-design.md`

## Global Constraints

- **Dépend du sub-project 04, implémenté avant** : `protocol.ts` porte déjà `GetInterruptedRunCommand`, `ResumeRunCommand`, `DiscardRunCommand`, `InterruptedRunEvent`, `InterruptedRun` et `UnreadablePlan` (`found: number | string | null`). `handleLine` a un cas sans effet qui regroupe `interrupted_run`, `runs_listed` et `run_loaded`, dont ce plan sort `interrupted_run`.
- **Demande** : `get_interrupted_run` part une fois par démarrage du moteur, à la réception d'une `version` dont `versionMismatch()` est nul. `restart()` réarme la demande.
- **Invite** :
  - `p-dialog` modal, `[closable]="false"`, `[focusOnShow]="false"`, `styleClass="w-120"` ;
  - fondu `FADE_IN` par `[animate.enter]` sur le contenu ;
  - boutons `size="small"` ;
  - « Repartir de zéro » en `text` `secondary`, « Reprendre » en `primary`, « Plus tard » en `text` `secondary`.
- **Montage** : dans la branche non bloquée du shell, par `@defer (when interruptedRun() !== null; prefetch on idle(5s))`.
- **Geste** : l'invite se ferme au clic (`cleared()`). Un refus de `resume_run` ou de `discard_run` s'affiche sur l'onglet Tagging et le plan est reproposé au prochain lancement.
- **Pas de confirmation** sur « Repartir de zéro ».
- **« Reprendre »** : appelle `resume` puis `router.navigateByUrl("/tagging")`.
- **Confirmation de sortie** : seuls restent `extraction`, `write` et `rollback`.
- **Textes** : clés `resume.*` dans les deux langues dans le même commit, vouvoiement, espace insécable U+00A0 avant `:` et `?` en français (écrite `\u00a0` dans les JSON ci-dessous, que le fichier existant porte en caractère brut : les deux se valent), une phrase par ligne. Aucun libellé en dur. Un plan corrompu (`found` nul) a son propre texte, sans version.
- **Tokens seulement** (`text-sm`, `text-muted-color`, `text-color`, `gap-2`), jamais de valeur en dur. Aucun `changeDetection` déclaré (`OnPush` est le défaut d'Angular 22), fonctions `const f = () =>`.
- **Tests** : noms en anglais, AAA. Les traductions s'affichent en clés brutes (`provideTranslateService()` sans loader).
- **Gate vert à chaque commit** : `just format-ui` puis `just lint-ui && just typecheck-ui && just test-ui`. Le code ci-dessous est écrit à la main : Prettier peut le reformater. Commits `type(scope): description`, scope `ui`.

## Review Focus

- **Moteur en conflit de version** : aucune demande n'est envoyée et aucune invite ne s'ouvre (Task 1, `does not ask for an interrupted run from a mismatched engine`).
- **Moteur redémarré après un crash en plein run** : la demande repart et le run coupé est proposé (Task 1, `asks again after a restart`).
- **Double clic sur « Reprendre » ou « Repartir de zéro »** : une seule commande part, l'invite étant fermée au premier clic (Task 1, `sends resume_run only once` et `sends discard_run only once`).
- **Reprise ou abandon refusé** : la page Tagging affiche l'erreur comme un refus de lancement et le run n'est pas marqué en cours (Task 1, entrée `resume_run` de `LAUNCHES` ; Task 3, `shows a refused %s like a refused start`).
- **Deux plans à la suite** : après « Repartir de zéro », l'annonce du plan plus ancien rouvre l'invite (Task 1, `closes the prompt at the gesture then prompts the next run`).
- **Entrée à l'ouverture de l'invite** : aucun bouton n'a le focus, Entrée ne supprime pas le plan (Task 2, `leaves the initial focus off the destructive button`).
- **Plan corrompu, sans version lisible** : aucun texte de version (Task 2, `names a damaged plan without any version`).
- **Onglet Tagging déjà affiché pendant la reprise** : le champ dossier suit le run, le bouton d'action propose la confirmation (Task 3, `follows the folder of a run resumed while the page is shown`).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `src/app/core/resume.store.ts` | Run annoncé, remise à plus tard, fermeture au geste |
| `src/app/core/sidecar.service.ts` | Demande, routage, `resume`, `discard`, `dismissInterruptedRun`, `prepareRun`, `launches` |
| `src/app/shared/utils/run-date.ts` | `runDate`, partagé par l'invite et les Réglages |
| `src/app/shared/components/resume-dialog.component.ts` | Invite de reprise (template inline) |
| `src/app/app.component.html`, `app.component.ts`, `app.component.spec.ts` | Montage différé de l'invite, stub du spec |
| `src/app/features/tagging/tagging-page.component.ts`, `.spec.ts` | Erreur de `resume_run` et `discard_run`, champ dossier lié à `requestedFolder()` |
| `src/app/features/settings/settings-page.component.ts` | Importe `runDate` |
| `src/app/core/close-guard.service.ts`, `.spec.ts` | Trois cas retirés |
| `src/app/shared/components/close-confirmation.component.spec.ts` | Spec ajusté (le composant ne change pas) |
| `src/fixtures/resume.ts` | Annonces des quatre états |
| `public/i18n/{fr,en}.json` | `resume.*` ajoutées, `app.close.{tagging,arbitration,unwritten}` retirées |
| `docs/DESIGN.md`, `.design-sync/NOTES.md` | Lignes d'overlay, largeur, arbitrages, écarts à la maquette |

---

### Task 1: Store et service de la reprise

**Files:**
- Create: `src/app/core/resume.store.ts`, `src/app/core/resume.store.spec.ts`
- Create: `src/fixtures/resume.ts`
- Modify: `src/app/core/sidecar.service.ts`
- Test: `src/app/core/sidecar.service.spec.ts`

**Interfaces:**
- Consumes: `InterruptedRun`, `UnreadablePlan`, `InterruptedRunEvent` (04).
- Produces :
  - `ResumeStore` : `prompt: Signal<DetectedRun | null>`, `announced(run: DetectedRun | null): void`, `dismissed(): void`, `cleared(): void` ;
  - `type DetectedRun = InterruptedRun | UnreadablePlan` ;
  - sur `SidecarService` :
    - `interruptedRun: Signal<DetectedRun | null>` ;
    - `resume(run: InterruptedRun): Promise<void>` ;
    - `discard(runId: string): Promise<void>` ;
    - `dismissInterruptedRun(): void` ;
    - privée : `prepareRun(folder: string): void`, la remise à zéro d'un lancement, que 06 élargit à `string | null` ;
  - fixtures `INTERRUPTED`, `FOLDER_MISSING`, `UNREADABLE`, `CORRUPTED`, `interruptedRun(run)`.

- [ ] **Step 1: Écrire les fixtures**

`src/fixtures/resume.ts` :

```ts
import type { InterruptedRun, InterruptedRunEvent, UnreadablePlan } from "../app/core/models/protocol"

export const INTERRUPTED: InterruptedRun = {
  kind: "interrupted",
  run_id: "a3f9c1",
  started_at: "2026-08-02T18:40:00Z",
  folder: "D:/Sets/Aout",
  processed: 62,
  total: 100,
  folder_missing: false,
}

/** Dossier absent ou vidé de ses fichiers audio : le sidecar ne les distingue pas (`folder_missing`). */
export const FOLDER_MISSING: InterruptedRun = { ...INTERRUPTED, folder_missing: true }

export const UNREADABLE: UnreadablePlan = {
  kind: "unreadable",
  run_id: "9e8f7a",
  started_at: "2026-08-02T18:40:00Z",
  found: 2,
  expected: 1,
}

/** Fichier du plan que le sidecar n'a pas su lire : aucune version à citer. */
export const CORRUPTED: UnreadablePlan = { ...UNREADABLE, run_id: "5d4c3b", found: null }

export const interruptedRun = (run: InterruptedRunEvent["run"]): InterruptedRunEvent => ({
  event: "interrupted_run",
  run,
})
```

- [ ] **Step 2: Écrire les tests**

`src/app/core/resume.store.spec.ts` :

```ts
import { TestBed } from "@angular/core/testing"

import { INTERRUPTED } from "../../fixtures/resume"

import { ResumeStore } from "./resume.store"

describe("ResumeStore", () => {
  let store: ResumeStore

  beforeEach(() => {
    store = TestBed.inject(ResumeStore)
  })

  it("prompts the announced run", () => {
    store.announced(INTERRUPTED)

    const prompt = store.prompt()

    expect(prompt).toEqual(INTERRUPTED)
  })

  it("prompts nothing once the run is put off", () => {
    store.announced(INTERRUPTED)

    store.dismissed()

    expect(store.prompt()).toBeNull()
  })

  it("prompts nothing once the engine announces no run", () => {
    store.announced(INTERRUPTED)

    store.announced(null)

    expect(store.prompt()).toBeNull()
  })

  it("closes the prompt at the gesture and opens it again on the next announcement", () => {
    store.announced(INTERRUPTED)
    store.cleared()
    const closed = store.prompt()

    store.announced({ ...INTERRUPTED, run_id: "1b2c3d" })

    expect(closed).toBeNull()
    expect(store.prompt()?.run_id).toBe("1b2c3d")
  })
})
```

Dans `src/app/core/sidecar.service.spec.ts` :

1. Importer `INTERRUPTED` et `interruptedRun` depuis `../../fixtures/resume`.
2. Élargir le type des lancements (ligne 63) :

```ts
type LaunchCommand =
  | "extract_playlist"
  | "start_tagging"
  | "resume_run"
  | "commit_run"
  | "retry_write"
  | "rollback"
```

3. Dans `LAUNCHES` (describe `write phase`), insérer après l'entrée `start_tagging` :

```ts
      {
        command: "resume_run",
        own: "tagging",
        launch: async () => {
          await service.start()
          transport.emit(interruptedRun(INTERRUPTED))
          await service.resume(INTERRUPTED)
        },
        // Le run affiche est vide des l'envoi et l'invite fermee : seul « en cours » retombe.
        observe: () => ({ tagging: service.tagging(), prompted: service.interruptedRun() !== null }),
        sent: { tagging: true, prompted: false },
        refused: { tagging: false, prompted: false },
      },
```

4. Dans le `describe` principal, avant `describe("write phase", ...)` :

```ts
  describe("interrupted run", () => {
    const VERSION = { event: "version", version: APP_VERSION, api_key_configured: true } as const
    const askedCount = (): number =>
      transport.sent.filter((line) => commandOf(line) === "get_interrupted_run").length

    it("asks for an interrupted run once the engine version matches", async () => {
      await service.start()

      transport.emit(VERSION)

      expect(transport.sent.map(commandOf)).toEqual(["get_version", "get_interrupted_run"])
    })

    it("does not ask for an interrupted run from a mismatched engine", async () => {
      await service.start()

      transport.emit({ ...VERSION, version: "0.0.0-other" })

      expect(askedCount()).toBe(0)
    })

    it("asks again after a restart", async () => {
      await service.start()
      transport.emit(VERSION)

      await service.restart()
      transport.emit(VERSION)

      expect(askedCount()).toBe(2)
    })

    it("feeds the announced run", async () => {
      await service.start()

      transport.emit(interruptedRun(INTERRUPTED))

      expect(service.interruptedRun()).toEqual(INTERRUPTED)
    })

    it("sends resume_run only once", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.resume(INTERRUPTED)
      await service.resume(INTERRUPTED)

      const resumed = transport.sent.filter((line) => commandOf(line) === "resume_run")
      expect(resumed.map(parseLine)).toEqual([{ command: "resume_run", run_id: "a3f9c1" }])
      expect(service.interruptedRun()).toBeNull()
    })

    it("shows the resumed run as launched on its folder", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.resume(INTERRUPTED)

      expect(service.requestedFolder()).toBe(INTERRUPTED.folder)
      expect(service.tagging()).toBe(true)
    })

    it("fills the run from the events the engine replays", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))
      await service.resume(INTERRUPTED)

      transport.emit(RUN_STARTED)
      transport.emit(TRACK_RESOLVED)
      transport.emit(arbitrationRequired("b.mp3"))

      expect(service.taggingTracks().map((track) => track.state)).toEqual(["resolved", null])
      expect(service.arbitrationCount()).toBe(1)
    })

    it("closes the prompt at the gesture then prompts the next run", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.discard(INTERRUPTED.run_id)
      const closed = service.interruptedRun()
      transport.emit(interruptedRun({ ...INTERRUPTED, run_id: "1b2c3d" }))

      expect(parseLine(transport.sent.at(-1) ?? "")).toEqual({
        command: "discard_run",
        run_id: "a3f9c1",
      })
      expect(closed).toBeNull()
      expect(service.interruptedRun()?.run_id).toBe("1b2c3d")
    })

    it("sends discard_run only once", async () => {
      await service.start()
      transport.emit(interruptedRun(INTERRUPTED))

      await service.discard(INTERRUPTED.run_id)
      await service.discard(INTERRUPTED.run_id)

      const discarded = transport.sent.filter((line) => commandOf(line) === "discard_run")
      expect(discarded).toHaveLength(1)
    })
  })
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/core/resume.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: FAIL, `ResumeStore` introuvable.

- [ ] **Step 4: Écrire le store**

`src/app/core/resume.store.ts` :

```ts
import { computed, signal, Service } from "@angular/core"

import type { InterruptedRun, UnreadablePlan } from "./models/protocol"

export type DetectedRun = InterruptedRun | UnreadablePlan

/** Run interrompu annonce au lancement ; `undefined` tant que l'interface n'a pas demande. */
@Service()
export class ResumeStore {
  private readonly _detected = signal<DetectedRun | null | undefined>(undefined)
  private readonly _dismissed = signal(false)

  /** Le run a proposer : nul sans annonce, sans run, ou remis a plus tard pour la session. */
  readonly prompt = computed(() => (this._dismissed() ? null : (this._detected() ?? null)))

  announced(run: DetectedRun | null): void {
    this._detected.set(run)
    this._dismissed.set(false)
  }

  dismissed(): void {
    this._dismissed.set(true)
  }

  /** Geste parti : l'invite se ferme sans attendre, l'annonce suivante la rouvrira s'il le faut. */
  cleared(): void {
    this._detected.set(null)
  }
}
```

- [ ] **Step 5: Câbler le service**

Dans `src/app/core/sidecar.service.ts` :

1. Imports : ajouter `InterruptedRun` à l'import de `./models/protocol` et `import { ResumeStore } from "./resume.store"` entre celui-ci et `./sidecar-transport`.

2. Champs, après `private readonly writePhase = inject(WriteStore)` :

```ts
  private readonly resumeStore = inject(ResumeStore)
```

Dans le bloc de délégation, après `readonly requestedFolder = this._requestedFolder.asReadonly()` :

```ts
  /** Run interrompu a proposer au lancement, ou nul : l'annonce du demarrage, puis ce qu'en ont fait les gestes. */
  readonly interruptedRun = this.resumeStore.prompt
```

Après `private started = false` :

```ts
  private interruptedRunAsked = false
```

3. Dans `launches`, après `start_tagging` :

```ts
    // Meme lancement que `start_tagging` : un refus remet l'etat du run, rien d'autre.
    resume_run: {
      phase: "tagging",
      undo: () => {
        this.taggingRun.failed()
      },
    },
```

4. Dans `restart()`, avant `await this.start()` : `this.interruptedRunAsked = false`.

5. Dans `handleLine`, cas `version`, après les deux `set` :

```ts
        void this.askInterruptedRun()
```

Retirer `case "interrupted_run":` du groupe sans effet laissé par 04 (il reste `runs_listed` et `run_loaded`) et ajouter avant `case "run_finished":` :

```ts
      case "interrupted_run":
        this.resumeStore.announced(event.run)
        break
```

6. Remplacer le corps de `startTagging` par l'appel à `prepareRun` :

```ts
  /** Sans ce garde, `reset()` viderait la liste d'un run en cours ou en ecriture. */
  async startTagging(folder: string, thresholds?: ThresholdsPayload): Promise<void> {
    if (this.taggingRun.running() || this.filesBusy()) {
      return
    }
    this.prepareRun(folder)
    // `JSON.stringify` omet une cle `undefined` : la commande part sans `thresholds`.
    await this.send({ command: "start_tagging", folder, thresholds })
  }
```

7. Ajouter, sous `cancelTagging` :

```ts
  /**
   * Les evenements rejoues par le moteur remplissent le run comme un lancement. L'invite est deja
   * fermee et le run marque en cours a l'envoi : un second clic ne repart pas.
   */
  async resume(run: InterruptedRun): Promise<void> {
    if (
      this.interruptedRun()?.run_id !== run.run_id ||
      this.taggingRun.running() ||
      this.filesBusy()
    ) {
      return
    }
    this.resumeStore.cleared()
    this.prepareRun(run.folder)
    await this.send({ command: "resume_run", run_id: run.run_id })
  }

  /** L'annonce qui revient dit s'il reste un autre run a reprendre. */
  async discard(runId: string): Promise<void> {
    if (this.interruptedRun()?.run_id !== runId) {
      return
    }
    this.resumeStore.cleared()
    await this.send({ command: "discard_run", run_id: runId })
  }

  dismissInterruptedRun(): void {
    this.resumeStore.dismissed()
  }
```

8. Ajouter, sous `send` :

```ts
  /**
   * Une fois par demarrage du moteur et seulement face au moteur attendu : un moteur en conflit
   * ne reprend rien.
   */
  private async askInterruptedRun(): Promise<void> {
    if (this.interruptedRunAsked || this.versionMismatch() !== null) {
      return
    }
    this.interruptedRunAsked = true
    await this.send({ command: "get_interrupted_run" })
  }

  /** Efface le run precedent des l'envoi de la commande : l'ecran ne melange rien. */
  private prepareRun(folder: string): void {
    this._requestedFolder.set(folder)
    this.taggingRun.reset()
    this.writePhase.reset()
    // Le sidecar jette les arbitrages de l'ancien run a la reception de la commande.
    this.arbitration.clear()
    this.urlRecovery.clear()
  }
```

- [ ] **Step 6: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/core/resume.store.spec.ts --include src/app/core/sidecar.service.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 7: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/core/resume.store.ts src/app/core/resume.store.spec.ts src/app/core/sidecar.service.ts src/app/core/sidecar.service.spec.ts src/fixtures/resume.ts
git commit -m "feat(ui): annonce et gestes de la reprise d'un run interrompu"
```

---

### Task 2: Invite de reprise

**Files:**
- Create: `src/app/shared/utils/run-date.ts`
- Create: `src/app/shared/components/resume-dialog.component.ts`, `resume-dialog.component.spec.ts`
- Modify: `src/app/features/settings/settings-page.component.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes : `SidecarService.interruptedRun`, `resume`, `discard`, `dismissInterruptedRun` (Task 1) ; fixtures `INTERRUPTED`, `FOLDER_MISSING`, `UNREADABLE`, `CORRUPTED`.
- Produces :
  - `runDate(iso: string, language: string | null): string` dans `shared/utils/run-date.ts` ;
  - le composant `app-resume-dialog` (`ResumeDialogComponent`).

- [ ] **Step 1: Lire la maquette**

Lire dans `.design-sync/design-system/ui_kits/techno-tagger/AppShell.jsx` la `Dialog` pilotée par l'état `resume` (titre, deux lignes, ordre et variantes des deux boutons) et les fiches `components/overlay/Dialog.prompt.md`, `components/forms/Button.prompt.md` et `components/overlay/TruncatedText.prompt.md`. La maquette fait foi sur l'apparence, ce plan sur le comportement (`.claude/rules/design/claude-design.md`).

- [ ] **Step 2: Écrire les tests**

`src/app/shared/components/resume-dialog.component.spec.ts` :

```ts
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { Router, provideRouter } from "@angular/router"
import { provideTranslateService } from "@ngx-translate/core"

import { action, page } from "../../../fixtures/dialog"
import { CORRUPTED, FOLDER_MISSING, INTERRUPTED, UNREADABLE } from "../../../fixtures/resume"
import type { DetectedRun } from "../../core/resume.store"
import { SidecarService } from "../../core/sidecar.service"

import { ResumeDialogComponent } from "./resume-dialog.component"

const mount = (run: DetectedRun | null) => {
  const sidecar = {
    interruptedRun: signal<DetectedRun | null>(run),
    resume: vi.fn(() => Promise.resolve()),
    discard: vi.fn(() => Promise.resolve()),
    dismissInterruptedRun: vi.fn(),
  }
  TestBed.configureTestingModule({
    imports: [ResumeDialogComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: SidecarService, useValue: sidecar },
    ],
  })
  const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true)
  const fixture = TestBed.createComponent(ResumeDialogComponent)
  fixture.detectChanges()

  return { fixture, component: fixture.componentInstance, sidecar, navigate }
}

describe("ResumeDialogComponent", () => {
  it("sums up the interrupted run", () => {
    const { component } = mount(INTERRUPTED)

    const text = page().textContent

    expect(text).toContain("resume.title")
    expect(text).toContain("resume.summary")
    expect(text).toContain(INTERRUPTED.folder)
    expect(component["summary"]()).toMatchObject({ processed: 62, total: 100 })
  })

  it("leaves the initial focus off the destructive button", async () => {
    const { fixture } = mount(INTERRUPTED)

    await fixture.whenStable()

    expect(document.activeElement).not.toBe(action("discard"))
  })

  it("resumes the run then shows the tagging tab", async () => {
    const { sidecar, navigate } = mount(INTERRUPTED)

    action("resume")?.click()

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/tagging")
    })
    expect(sidecar.resume).toHaveBeenCalledWith(INTERRUPTED)
  })

  it("starts over without asking", () => {
    const { sidecar } = mount(INTERRUPTED)

    action("discard")?.click()

    expect(sidecar.discard).toHaveBeenCalledWith(INTERRUPTED.run_id)
  })

  it("offers to come back later when the folder is gone", () => {
    const { sidecar } = mount(FOLDER_MISSING)
    const resumable = action("resume")

    action("later")?.click()

    expect(resumable).toBeNull()
    expect(page().textContent).toContain("resume.folderMissing")
    expect(sidecar.dismissInterruptedRun).toHaveBeenCalledOnce()
  })

  it("only lets an unreadable plan be discarded, naming both versions", () => {
    mount(UNREADABLE)

    const offered = [action("resume"), action("later"), action("discard")].map(
      (button) => button !== null,
    )

    expect(offered).toEqual([false, false, true])
    expect(page().textContent).toContain("resume.unreadable.version")
  })

  it("names a damaged plan without any version", () => {
    mount(CORRUPTED)

    const text = page().textContent

    expect(text).toContain("resume.unreadable.corrupted")
    expect(text).not.toContain("resume.unreadable.version")
    expect(action("discard")).not.toBeNull()
  })

  it("shows nothing without an interrupted run", () => {
    mount(null)

    const opened = page().textContent.includes("resume.title")

    expect(opened).toBe(false)
  })
})
```

- [ ] **Step 3: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/shared/components/resume-dialog.component.spec.ts --watch=false`
Expected: FAIL, `ResumeDialogComponent` introuvable.

- [ ] **Step 4: Extraire `runDate`**

`src/app/shared/utils/run-date.ts` :

```ts
/** `Intl` et non `DatePipe` : aucune locale FR n'est enregistree. */
export const runDate = (iso: string, language: string | null): string => {
  const date = new Date(iso)
  // `format` leve une RangeError sur une date invalide et un computed la relancerait a chaque lecture.
  if (Number.isNaN(date.getTime())) {
    return iso
  }

  return new Intl.DateTimeFormat(language ?? undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}
```

Dans `settings-page.component.ts`, supprimer la fonction locale `runDate` et son commentaire, puis ajouter `import { runDate } from "../../shared/utils/run-date"` entre l'import de `motion` et celui de `tooltip`. Le test existant `renders the raw date of a run whose date cannot be parsed` de `settings-page.component.spec.ts` couvre toujours la date invalide.

- [ ] **Step 5: Écrire le composant**

`src/app/shared/components/resume-dialog.component.ts` :

```ts
import { Component, computed, inject } from "@angular/core"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Dialog } from "primeng/dialog"

import type { InterruptedRun } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import { FADE_IN } from "../utils/motion"
import { runDate } from "../utils/run-date"

import { TruncatedTextComponent } from "./truncated-text.component"

/**
 * Invite non fermable : le run interrompu attend un choix. « Plus tard » n'existe que pour un
 * dossier introuvable, qu'un disque rebranche rendra reprenable au lancement suivant. Aucun
 * focus a l'ouverture : le premier bouton est « Repartir de zero » et Entree supprimerait le plan.
 */
@Component({
  selector: "app-resume-dialog",
  imports: [Dialog, ButtonDirective, TranslatePipe, TruncatedTextComponent],
  template: `
    @if (run(); as detected) {
      <!-- 30rem, la largeur de la Dialog d'AppShell (DESIGN.md § Structure de Page). -->
      <p-dialog
        [visible]="true"
        [modal]="true"
        [closable]="false"
        [draggable]="false"
        [resizable]="false"
        [focusOnShow]="false"
        styleClass="w-120"
      >
        <ng-template #header>
          <h3 class="m-0 text-lg font-semibold">{{ "resume.title" | translate }}</h3>
        </ng-template>

        <div
          class="flex flex-col gap-2 text-sm whitespace-pre-line text-muted-color"
          [animate.enter]="fadeIn"
        >
          @if (detected.kind === "unreadable") {
            <p class="m-0">
              {{
                (detected.found === null
                  ? "resume.unreadable.corrupted"
                  : "resume.unreadable.version"
                ) | translate: { found: detected.found, expected: detected.expected }
              }}
            </p>
          } @else {
            <p class="m-0">{{ "resume.summary" | translate: summary() }}</p>
            <app-truncated-text class="text-color" [text]="detected.folder" />
            <p class="m-0">
              {{ (detected.folder_missing ? "resume.folderMissing" : "resume.safe") | translate }}
            </p>
          }
        </div>

        <ng-template #footer>
          @if (detected.kind === "interrupted" && detected.folder_missing) {
            <button
              pButton
              type="button"
              size="small"
              [text]="true"
              severity="secondary"
              data-action="later"
              (click)="later()"
            >
              {{ "resume.later" | translate }}
            </button>
          }
          <button
            pButton
            type="button"
            size="small"
            [text]="true"
            severity="secondary"
            data-action="discard"
            (click)="discard(detected.run_id)"
          >
            {{ "resume.discard" | translate }}
          </button>
          @if (detected.kind === "interrupted" && !detected.folder_missing) {
            <button
              pButton
              type="button"
              size="small"
              data-action="resume"
              (click)="resume(detected)"
            >
              {{ "resume.resume" | translate }}
            </button>
          }
        </ng-template>
      </p-dialog>
    }
  `,
})
export class ResumeDialogComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly router = inject(Router)
  private readonly translate = inject(TranslateService)

  protected readonly run = this.sidecar.interruptedRun
  protected readonly fadeIn = FADE_IN
  protected readonly summary = computed(() => {
    const run = this.run()

    return run?.kind === "interrupted"
      ? {
          date: runDate(run.started_at, this.translate.currentLang()),
          processed: run.processed,
          total: run.total,
        }
      : null
  })

  protected async resume(run: InterruptedRun): Promise<void> {
    await this.sidecar.resume(run)
    await this.router.navigateByUrl("/tagging")
  }

  protected discard(runId: string): void {
    void this.sidecar.discard(runId)
  }

  protected later(): void {
    this.sidecar.dismissInterruptedRun()
  }
}
```

`TruncatedTextComponent` (`app-truncated-text`, entrée `text`) et `translate.currentLang()` sont ceux qu'emploie déjà `settings-page.component.ts`. `(click)="resume(detected)"` reçoit un `InterruptedRun` : la branche `@if (detected.kind === "interrupted" && ...)` le fait narrower.

- [ ] **Step 6: Ajouter les textes**

`public/i18n/fr.json`, nouvel espace de noms `resume`, au premier niveau :

```json
  "resume": {
    "title": "Reprendre le run interrompu\u00a0?",
    "summary": "Run du {{date}}, {{processed}} / {{total}} traités, sur\u00a0:",
    "safe": "Aucun fichier n'a été touché entre-temps\u00a0: la reprise est sans risque.",
    "folderMissing": "Ce dossier est introuvable ou ne contient plus de fichier audio.\nRebranchez le disque ou remettez les fichiers en place, puis relancez l'application.",
    "unreadable": {
      "version": "Ce run a été enregistré par une autre version de l'application (version {{found}}, attendue {{expected}}).\nIl ne peut pas être repris\u00a0: repartez de zéro.",
      "corrupted": "Le fichier de ce run est endommagé.\nIl ne peut pas être repris\u00a0: repartez de zéro."
    },
    "resume": "Reprendre",
    "discard": "Repartir de zéro",
    "later": "Plus tard"
  },
```

`public/i18n/en.json` :

```json
  "resume": {
    "title": "Resume the interrupted run?",
    "summary": "Run of {{date}}, {{processed}} / {{total}} processed, on:",
    "safe": "No file was touched since: resuming is safe.",
    "folderMissing": "This folder cannot be found or no longer holds any audio file.\nPlug the drive back in or put the files back, then restart the application.",
    "unreadable": {
      "version": "This run was saved by another version of the application (version {{found}}, expected {{expected}}).\nIt cannot be resumed: start over.",
      "corrupted": "The file of this run is damaged.\nIt cannot be resumed: start over."
    },
    "resume": "Resume",
    "discard": "Start over",
    "later": "Later"
  },
```

- [ ] **Step 7: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/shared/components/resume-dialog.component.spec.ts --include src/app/features/settings/settings-page.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 8: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/shared/components/resume-dialog.component.ts src/app/shared/components/resume-dialog.component.spec.ts src/app/shared/utils/run-date.ts src/app/features/settings/settings-page.component.ts public/i18n
git commit -m "feat(ui): invite de reprise d'un run interrompu"
```

---

### Task 3: Montage de l'invite et suivi de la reprise par la page Tagging

**Files:**
- Modify: `src/app/app.component.html`, `src/app/app.component.ts`, `src/app/app.component.spec.ts`
- Modify: `src/app/features/tagging/tagging-page.component.ts`, `tagging-page.component.spec.ts`
- Modify: `docs/DESIGN.md`, `.design-sync/NOTES.md`

**Interfaces:**
- Consumes : `ResumeDialogComponent` (Task 2) ; `SidecarService.interruptedRun`, `requestedFolder` (Task 1).
- Produces : l'invite montée dans le shell ; `TaggingPageComponent.folder` lié à `requestedFolder()`.

- [ ] **Step 1: Écrire les tests de la page Tagging**

Dans `src/app/features/tagging/tagging-page.component.spec.ts`, après le test `shows an error raised by commit_run`, ajouter :

```ts
  it.each([
    ["resume_run", "tagging_folder_unreadable"],
    ["discard_run", "run_not_found"],
  ] as const)("shows a refused %s like a refused start", async (command, code) => {
    const failure: SidecarErrorEvent = {
      event: "error",
      code,
      params: {},
      message: "",
      command,
    }
    const { component } = await mountWith({
      lastError: signal(failure),
      lastErrorCommand: signal(command),
    })

    const shown = component["error"]()

    expect(shown?.code).toBe(code)
  })

  it("follows the folder of a run resumed while the page is shown", async () => {
    const requestedFolder = signal<string | null>(null)
    const { component } = await mountWith({
      requestedFolder,
      taggingRunId: signal("a3f9c1"),
      runConfirmable: signal(true),
    })
    const before = component["action"]()

    requestedFolder.set("D:/Sets/Resumed")

    expect(before).toBe("start")
    expect(component["folder"]()).toBe("D:/Sets/Resumed")
    expect(component["action"]()).toBe("commit")
  })
```

Le stub `mountWith` du fichier porte déjà `requestedFolder`, `runConfirmable`, `lastError` et `lastErrorCommand` : aucun signal à ajouter.

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/features/tagging/tagging-page.component.spec.ts --watch=false`
Expected: FAIL, `shows a refused resume_run` (l'erreur n'est pas relayée) et `follows the folder` (le champ ne bouge pas).

- [ ] **Step 3: Adapter la page Tagging**

Dans `src/app/features/tagging/tagging-page.component.ts` :

1. Import d'Angular : retirer `signal`, ajouter `linkedSignal` (`signal` ne servait qu'au champ dossier) :

```ts
import { Component, computed, inject, linkedSignal } from "@angular/core"
```

2. Remplacer `protected readonly folder = signal("")` par :

```ts
  /**
   * Dossier du champ : celui du run affiche (`requestedFolder`, la forme que compare `action`).
   * Une reprise le pose pendant que la page est montee et le champ le suit.
   */
  protected readonly folder = linkedSignal<string | null, string>({
    source: this.sidecar.requestedFolder,
    computation: (requested, previous) => requested ?? previous?.value ?? "",
  })
```

3. Ajouter les deux commandes à l'erreur affichée :

```ts
  protected readonly error = this.sidecar.errorFor(
    "start_tagging",
    "resume_run",
    "discard_run",
    "commit_run",
    "retry_write",
    "rollback",
  )
```

4. Remplacer `prefill` :

```ts
  private async prefill(): Promise<void> {
    // Page recreee : le run affiche prime sur la derniere destination et `folder` le suit deja.
    if (this.sidecar.requestedFolder() !== null) {
      return
    }
    const destination = await readLastDestination()
    if (destination !== null && this.folder() === "") {
      this.folder.set(destination)
    }
  }
```

- [ ] **Step 4: Monter l'invite dans le shell**

Dans `src/app/app.component.html`, dans la branche non bloquée (le `@else` du `@if (blocked(); as reason)`), après le bloc `@defer` de l'arbitrage :

```html
  <!-- Differee comme les deux autres modales : `p-dialog` n'a rien a faire au demarrage et la
       plupart des lancements n'ont aucun run a reprendre. Dans la branche non bloquee : un moteur
       absent ou en conflit de version n'a rien a proposer. -->
  @defer (when interruptedRun() !== null; prefetch on idle(5s)) {
    <app-resume-dialog />
  }
```

Dans `src/app/app.component.ts` : importer `ResumeDialogComponent` depuis `./shared/components/resume-dialog.component`, l'ajouter aux `imports` du composant et ajouter après `protected readonly arbitrationCount = this.sidecar.arbitrationCount` :

```ts
  protected readonly interruptedRun = this.sidecar.interruptedRun
```

Dans `src/app/app.component.spec.ts`, le stub du service lit `interruptedRun` dès la construction du composant. Importer `import type { DetectedRun } from "./core/resume.store"` et ajouter au stub, après `urlRecoveryBusy` :

```ts
    // Lu par le `@defer` de l'invite de reprise.
    interruptedRun: signal<DetectedRun | null>(null),
```

Les tests existants restent valables : `DeferBlockBehavior.Manual` ne rend pas l'invite, qui a ses propres tests.

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/features/tagging/tagging-page.component.spec.ts --include src/app/app.component.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 6: Contrôler le découpage**

Run: `pnpm exec ng build --stats-json`
Expected: build vert. Charger `browser-stats.json` dans l'analyseur d'esbuild (esbuild.github.io/analyze) : `resume-dialog.component` figure dans un chunk différé, pas dans les fichiers initiaux (`.claude/rules/angular/routing.md`).

- [ ] **Step 7: Documenter**

Relire les lignes citées avant d'éditer : leurs numéros sont ceux du 2026-10-12.

Dans `docs/DESIGN.md` :
- **§ Overlays, ligne « Reprise d'un run interrompu »** (L288) : remplacer la colonne Composant par « `ResumeDialogComponent` : `p-dialog` modal non fermable, `w-120` », la colonne Librairie par « composant maison (PrimeNG) » et les notes par « Au démarrage, une fois la version du moteur vérifiée, différée comme les autres modales. Aucun focus à l'ouverture (`focusOnShow` coupé) : Entrée ne supprime jamais le plan. Boutons `small` : « Repartir de zéro » en texte `secondary`, « Reprendre » en `primary`. Dossier introuvable ou vidé : « Plus tard » et « Repartir de zéro ». Plan illisible ou corrompu : « Repartir de zéro » seul. Aucune confirmation : aucun fichier n'est touché ».
- **§ Structure de Page**, après la ligne « Confirmation d'un geste sur les fichiers » (L405) : ajouter « Invite de reprise | 30rem (`w-120`) | Largeur de la `Dialog` d'`AppShell`, reprise telle quelle. Le titre et les trois boutons français du dossier introuvable sont à contrôler à l'écran par `/verify` ».
- **§ Arbitrages**, ajouter, datés du jour de l'implémentation :
  - « Invite de reprise : dossier introuvable ou vidé, plan illisible et plan corrompu », trois états que la maquette ne montre pas, avec « Plus tard » réservé au dossier introuvable ou vidé ;
  - « Focus de l'invite de reprise : aucun bouton focalisé à l'ouverture, là où `Dialog` focalise le premier. Entrée ne supprime pas le plan ».
- **§ Arbitrages, « Taille des boutons »** (L541) : retirer « et « Reprendre » » de la liste des boutons que la maquette laisse à la taille par défaut. La `Dialog` d'`AppShell` les pose déjà en `size="small"`.

Dans `.design-sync/NOTES.md` § Reste ouvert, remplacer la ligne « Rien à pousser au 2026-10-11. » (L74) par : « `AppShell` : états « dossier introuvable ou vidé », « plan illisible » et « plan corrompu » de l'invite de reprise, livrés par le code et absents de la maquette. Focus de l'invite coupé à l'ouverture ».

- [ ] **Step 8: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/app.component.html src/app/app.component.ts src/app/app.component.spec.ts src/app/features/tagging/tagging-page.component.ts src/app/features/tagging/tagging-page.component.spec.ts docs/DESIGN.md .design-sync/NOTES.md
git commit -m "feat(ui): monter l'invite de reprise et suivre le run repris"
```

---

### Task 4: Confirmation de sortie réduite

**Files:**
- Modify: `src/app/core/close-guard.service.ts`, `close-guard.service.spec.ts`
- Modify: `src/app/shared/components/close-confirmation.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`
- Modify: `docs/DESIGN.md`, `.design-sync/NOTES.md`, `docs/adrs/009-enchainement-sources-et-arbitrage.md`

**Interfaces:**
- Consumes : `SidecarService.extracting`, `writing`, `rollingBack`.
- Produces : `PendingWork = { kind: "extraction" } | { kind: "write" } | { kind: "rollback" }`.

- [ ] **Step 1: Réécrire les tests de la garde**

Dans `src/app/core/close-guard.service.spec.ts`, le helper réel est `setup()` (sans autre option que `inTauri`). Son stub garde `tagging`, `runConfirmable` et `arbitrationCount` : la garde ne les lit plus et c'est ce que le premier test ci-dessous prouve. Ajouter au-dessus de `const sidecar = {` :

```ts
  // `tagging`, `runConfirmable` et `arbitrationCount` : la garde ne les lit plus (plan de run).
```

Réécrire ces tests, les autres restent tels quels :

1. Remplacer le `it.each` `holds the window and asks for confirmation during %s` (extraction, run, arbitrages) par :

```ts
  it("holds the window and asks for confirmation during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)

    const held = appWindow.close()

    expect(held).toBe(true)
    expect(guard.request()).toEqual([{ kind: "extraction" }])
  })

  it("lets the window close during a run, with arbitrations pending or a run left unwritten", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.tagging.set(true)
    sidecar.arbitrationCount.set(3)
    sidecar.runConfirmable.set(true)

    const held = appWindow.close()

    expect(held).toBe(false)
    expect(guard.request()).toBeNull()
  })
```

2. Remplacer `lists the pending work in a fixed order` :

```ts
  it("lists the pending work in a fixed order", async () => {
    const { sidecar, guard } = await setup()

    sidecar.rollingBack.set({ runId: "a3f9c1", trackId: null })
    sidecar.writing.set(true)
    sidecar.extracting.set(true)

    expect(guard.pendingWork()).toEqual([
      { kind: "extraction" },
      { kind: "write" },
      { kind: "rollback" },
    ])
  })
```

3. Supprimer `counts a run that could still be written as pending work` (couvert par le test 1).

4. Dans `closes the window for good when the user leaves`, `keeps the window open when the user stays` et `reopens the application when the window refuses to close`, remplacer `sidecar.tagging.set(true)` par `sidecar.extracting.set(true)`.

5. Remplacer `keeps the snapshot when the work ends during the confirmation` et `replaces the snapshot when closing is asked again` :

```ts
  it("keeps the snapshot when the work ends during the confirmation", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    sidecar.extracting.set(false)

    expect(guard.request()).toEqual([{ kind: "extraction" }])
  })

  it("replaces the snapshot when closing is asked again", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()
    sidecar.writing.set(true)

    appWindow.close()

    expect(guard.request()).toEqual([{ kind: "extraction" }, { kind: "write" }])
  })
```

6. Remplacer `lets the user leave a run that only waits` :

```ts
  it("lets the user leave during an extraction", async () => {
    const { appWindow, sidecar, guard } = await setup()
    sidecar.extracting.set(true)
    appWindow.close()

    await guard.leave()

    expect(guard.blocked()).toBe(false)
    expect(appWindow.destroyed).toBe(1)
  })
```

Dans `src/app/shared/components/close-confirmation.component.spec.ts`, remplacer la `request` du stub par `[{ kind: "extraction" }, { kind: "write" }]` et le test `names every pending work` :

```ts
  it("names every pending work", () => {
    mount()

    const text = page().textContent

    const positions = ["extraction", "write"].map((kind) => text.indexOf(`app.close.${kind}`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
```

- [ ] **Step 2: Lancer les tests, ils échouent**

Run: `pnpm exec ng test --include src/app/core/close-guard.service.spec.ts --include src/app/shared/components/close-confirmation.component.spec.ts --watch=false`
Expected: FAIL, `pendingWork` contient encore `tagging`, `arbitration` et `unwritten` (échec de `lets the window close during a run, with arbitrations pending or a run left unwritten`).

- [ ] **Step 3: Retirer les trois cas**

Dans `src/app/core/close-guard.service.ts` :

```ts
export type PendingWork =
  | { readonly kind: "extraction" }
  | { readonly kind: "write" }
  | { readonly kind: "rollback" }
```

et dans `pendingWork`, supprimer les blocs `tagging`, `arbitration` et `unwritten` (dont le commentaire « Un run cherche… »), puis ajouter au-dessus du `computed` :

```ts
  /**
   * Seul ce qui perd vraiment quelque chose retient la fenetre. Un run, ses arbitrages et un run
   * non confirme vivent dans le plan de run : ils sont proposes a la reprise au lancement suivant.
   */
```

Dans `public/i18n/fr.json` et `en.json`, supprimer `app.close.tagging`, `app.close.arbitration` et `app.close.unwritten`.

- [ ] **Step 4: Mettre à jour `docs/DESIGN.md`, `.design-sync/NOTES.md` et l'ADR-009**

- **`docs/DESIGN.md` § Overlays, ligne « Confirmation de sortie »** (L286) : « À la fermeture de la fenêtre pendant une extraction, une écriture ou un rollback », à la place de « pendant une extraction, un run (même cherché et non confirmé) ou des arbitrages ».
- **§ Arbitrages** : ajouter « Confirmation de sortie : run, arbitrages et run non confirmé ne retiennent plus la fenêtre, le plan de run les rend à la reprise. La maquette `CloseConfirmation` garde ces trois lignes », daté du jour de l'implémentation.
- **`.design-sync/NOTES.md` § Reste ouvert**, à la suite de la ligne ajoutée à la Task 3 : « `CloseConfirmation` : lignes `tagging`, `arbitration` et `unwritten` retirées par le code ».
- **`docs/adrs/009-enchainement-sources-et-arbitrage.md` § Notes complémentaires**, puce « Tentative de quitter l'application avec un travail en cours » : compléter par « , puis réduite le <date de l'implémentation> à l'extraction, à l'écriture et au rollback, le plan de run (ADR-010) rendant arbitrages et run à la reprise ».

- [ ] **Step 5: Lancer les tests, ils passent**

Run: `pnpm exec ng test --include src/app/core/close-guard.service.spec.ts --include src/app/shared/components/close-confirmation.component.spec.ts --include src/app/core/translations.spec.ts --watch=false`
Expected: PASS

- [ ] **Step 6: Gate et commit**

Run: `just format-ui && just lint-ui && just typecheck-ui && just test-ui`
Expected: tout vert

```bash
git add src/app/core/close-guard.service.ts src/app/core/close-guard.service.spec.ts src/app/shared/components/close-confirmation.component.spec.ts public/i18n docs/DESIGN.md .design-sync/NOTES.md docs/adrs/009-enchainement-sources-et-arbitrage.md
git commit -m "feat(ui): quitter en plein run ne demande plus rien, le plan le rend a la reprise"
```
