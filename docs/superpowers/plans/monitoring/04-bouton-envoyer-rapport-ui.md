# Bouton « Envoyer ce rapport » : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser dans le pied du récapitulatif le bouton « Envoyer ce rapport », qui ouvre dans le navigateur l'issue de retour pré-remplie du run affiché et révèle dans l'Explorateur l'export à y glisser.

**Architecture:** Une fonction `injectFeedbackSend(target)` (patron d'`injectRunRestore()`) porte la raison du grisé, l'attente, l'envoi de `prepare_feedback` et l'effet qui ouvre l'URL puis révèle l'export au `feedback_ready` de la demande retenue. `RecapPageComponent` lui fournit le run affiché et la présence de son rapport, lie le bouton du pied et affiche l'erreur du run. DESIGN.md et la maquette restent hors de ce plan (décision du propriétaire du 2026-10-16).

**Tech Stack:** Angular 22 (signals, `effect`), PrimeNG 22 (`pButton`, `pTooltip`), `@tauri-apps/plugin-opener`, ngx-translate, Vitest.

**Spec:** `docs/superpowers/specs/monitoring/04-bouton-envoyer-rapport-ui-design.md`

## Global Constraints

- Prérequis : `03-protocole-ndjson-retour` implémenté (`prepareFeedback`, `feedbackReady`, `feedbackPending` dans `SidecarService` et dans `sidecarStub`)
- Prérequis hors feature : `feature/settings` commitée avant la Feature 9. `settings.admin.starting`, `sidecar-stub.ts`, les fichiers i18n et `docs/ARCHITECTURE.md` n'existent ou ne sont modifiés que dans son working tree au 2026-10-16 et les `git add` ci-dessous embarqueraient ces changements
- Bouton `button pButton` `type="button"` `severity="secondary"` `[outlined]="true"` `size="small"`, icône 16px `external-link` (ou `spinner` en attente), dans le pied juste après « Retour à la liste », sans largeur figée
- `[pTooltip]` sur le bouton, `[tooltipOptions]` = `WIDE_TOOLTIP` ; bouton grisé jamais masqué
- Raisons du grisé, par priorité : `settings.admin.starting`, puis `recap.feedback.unavailable`
- Clés i18n : `recap.feedback.send`, `recap.feedback.hint`, `recap.feedback.unavailable`, dans les deux fichiers, vouvoiement, une phrase par ligne, espace insécable (`\u00a0`) avant `:`, `;`, `?`, `!` en FR
- Ni DESIGN.md ni `.design-sync/` ne sont modifiés par ce plan. Un écart entre eux et la spec, constaté à l'exécution, se pose au propriétaire avant de coder
- Fonctions TS en `const nom = (...) => ...` ; tests en anglais, AAA sans commentaire de section ; commentaires en français sans accents dans le code

## Review Focus

- **`feedback_ready` déjà présent à l'ouverture de la page** : rien ne s'ouvre. Test en Task 1
- **`openUrl` qui échoue** : l'Explorateur s'ouvre quand même sur l'export. Test en Task 1
- **Moteur perdu pendant l'attente** : le spinner retombe et le bouton se grise avec la raison du moteur, aucune erreur `sidecar_unavailable` ne s'affiche. Test en Task 1
- **Erreur de `prepare_feedback` sans `run_id`** (commande malformée) : elle s'affiche sur le récapitulatif courant, au lieu d'être filtrée comme celle d'un autre run. Test en Task 2
- **Run courant sans entrée dans les runs passés** (rapport non écrit) : bouton grisé, raison du rapport absent. Test en Task 2
- **Double clic pendant l'attente** : une seule commande. Test en Task 1

---

### Task 1 : `injectFeedbackSend`

**Files:**
- Create: `src/app/features/tagging/recap/feedback-send.ts`
- Create: `src/app/features/tagging/recap/feedback-send.spec.ts`

**Interfaces:**
- Consumes : `SidecarService.available`, `feedbackReady`, `feedbackPending`, `prepareFeedback(runId)` (03) ; `FeedbackReadyEvent` de `core/sidecar/protocol`
- Produces :
  - `interface FeedbackTarget { readonly runId: string; readonly hasReport: boolean }`
  - `injectFeedbackSend(target: Signal<FeedbackTarget | null>) => { blockedReason: Signal<string | null>; pending: Signal<boolean>; send: () => void }`

- [ ] **Step 1 : écrire les tests qui échouent**

`src/app/features/tagging/recap/feedback-send.spec.ts` :

```typescript
import { signal } from "@angular/core"
import { TestBed } from "@angular/core/testing"
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

import { sidecarStub } from "../../../../fixtures/sidecar-stub"
import type { FeedbackReadyEvent } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"

import { type FeedbackTarget, injectFeedbackSend } from "./feedback-send"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}))

const READY: FeedbackReadyEvent = {
  event: "feedback_ready",
  run_id: "a3f9c1",
  url: "https://github.example/issues/new?template=matching-report.yml",
  export_path: String.raw`C:\data\feedback\20261006T211403Z-a3f9c1.json`,
}

const setUp = (target: FeedbackTarget | null = { runId: "a3f9c1", hasReport: true }) => {
  const available = signal<boolean | null>(true)
  const ready = signal<FeedbackReadyEvent | null>(null)
  const pending = signal<string | null>(null)
  const service = sidecarStub({ available, feedbackReady: ready, feedbackPending: pending })
  TestBed.configureTestingModule({ providers: [{ provide: SidecarService, useValue: service }] })
  const send = TestBed.runInInjectionContext(() => injectFeedbackSend(signal(target)))

  return { send, service, available, ready, pending }
}

describe("injectFeedbackSend", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it("asks the engine for the issue of the run on screen", () => {
    const { send, service } = setUp()

    send.send()

    expect(service.prepareFeedback).toHaveBeenCalledWith("a3f9c1")
  })

  it("opens the issue then reveals the export once the asked run is ready", async () => {
    const calls: string[] = []
    vi.mocked(openUrl).mockImplementationOnce(() => {
      calls.push("open")
      return Promise.resolve()
    })
    vi.mocked(revealItemInDir).mockImplementationOnce(() => {
      calls.push("reveal")
      return Promise.resolve()
    })
    const { send, ready } = setUp()
    send.send()

    ready.set(READY)
    TestBed.tick()

    await vi.waitFor(() => {
      expect(calls).toEqual(["open", "reveal"])
    })
    expect(openUrl).toHaveBeenCalledWith(READY.url)
    expect(revealItemInDir).toHaveBeenCalledWith(READY.export_path)
  })

  it("still reveals the export when the browser does not open", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("no default browser"))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const { send, ready } = setUp()
    send.send()

    ready.set(READY)
    TestBed.tick()

    await vi.waitFor(() => {
      expect(revealItemInDir).toHaveBeenCalledWith(READY.export_path)
    })
  })

  it("opens nothing for the issue of another run", () => {
    const { send, ready } = setUp()
    send.send()

    ready.set({ ...READY, run_id: "b4c5d6" })
    TestBed.tick()

    expect(openUrl).not.toHaveBeenCalled()
  })

  it("opens nothing for an issue that was ready before the page asked", () => {
    const { ready } = setUp()

    ready.set(READY)
    TestBed.tick()

    expect(openUrl).not.toHaveBeenCalled()
  })

  it("asks once while the issue of the run is being prepared", () => {
    const { send, service, pending } = setUp()
    pending.set("a3f9c1")

    send.send()

    expect(send.pending()).toBe(true)
    expect(service.prepareFeedback).not.toHaveBeenCalled()
  })

  it("greys the button with the engine reason once the engine is lost during the wait", () => {
    const { send, available, pending } = setUp()
    pending.set("a3f9c1")

    pending.set(null)
    available.set(false)

    expect(send.pending()).toBe(false)
    expect(send.blockedReason()).toBe("settings.admin.starting")
  })

  it.each<[string, boolean | null, FeedbackTarget | null, string | null]>([
    ["an engine that is starting", null, { runId: "a3f9c1", hasReport: true }, "settings.admin.starting"],
    [
      "an engine that is starting and a run without report",
      null,
      { runId: "a3f9c1", hasReport: false },
      "settings.admin.starting",
    ],
    ["a run without report", true, { runId: "a3f9c1", hasReport: false }, "recap.feedback.unavailable"],
    ["no run on screen", true, null, "recap.feedback.unavailable"],
    ["a run with its report", true, { runId: "a3f9c1", hasReport: true }, null],
  ])("gives the reason of %s", (_case, engine, target, reason) => {
    const { send, available, service } = setUp(target)
    available.set(engine)

    send.send()

    expect(send.blockedReason()).toBe(reason)
    expect(service.prepareFeedback).toHaveBeenCalledTimes(reason === null ? 1 : 0)
  })
})
```

Si `sidecarStub` ne tape pas `available` en `boolean | null`, aligner le type du signal du test sur celui de `SidecarService.available`.

Run : `pnpm exec ng test --watch=false --include src/app/features/tagging/recap/feedback-send.spec.ts`
Expected : FAIL, `./feedback-send` introuvable

- [ ] **Step 2 : implémenter**

`src/app/features/tagging/recap/feedback-send.ts` :

```typescript
import { type Signal, computed, effect, inject, signal, untracked } from "@angular/core"
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener"

import type { FeedbackReadyEvent } from "../../../core/sidecar/protocol"
import { SidecarService } from "../../../core/sidecar/sidecar.service"

/** Run du recapitulatif et presence de son rapport, sans lequel le sidecar n'a rien a preparer. */
export interface FeedbackTarget {
  readonly runId: string
  readonly hasReport: boolean
}

/**
 * Le navigateur d'abord, l'Explorateur ensuite : il arrive au premier plan, l'export selectionne,
 * pret a glisser dans l'issue ouverte derriere. Un echec de l'un n'empeche pas l'autre.
 */
const openFeedback = async (ready: FeedbackReadyEvent): Promise<void> => {
  try {
    await openUrl(ready.url)
  } catch (error: unknown) {
    console.error("[recap] issue de retour non ouverte", error)
  }
  try {
    await revealItemInDir(ready.export_path)
  } catch (error: unknown) {
    console.error("[recap] export du run non revele", error)
  }
}

/**
 * « Envoyer ce rapport » : le sidecar prepare l'issue et l'export (ADR-014), la page les ouvre.
 * Seule une demande de cette page ouvre quelque chose : un `feedback_ready` deja recu a la
 * creation de la page, ou celui d'un autre run, ne rejoue rien.
 */
export const injectFeedbackSend = (target: Signal<FeedbackTarget | null>) => {
  const sidecar = inject(SidecarService)
  const requested = signal<string | null>(null)

  const blockedReason = computed(() => {
    if (sidecar.available() !== true) {
      return "settings.admin.starting"
    }

    return target()?.hasReport === true ? null : "recap.feedback.unavailable"
  })
  const pending = computed(() => {
    const runId = target()?.runId

    return runId !== undefined && sidecar.feedbackPending() === runId
  })

  effect(() => {
    const ready = sidecar.feedbackReady()
    if (ready === null || ready.run_id !== untracked(requested)) {
      return
    }
    requested.set(null)
    void openFeedback(ready)
  })

  return {
    blockedReason,
    pending,
    send: (): void => {
      const runId = target()?.runId
      if (runId === undefined || blockedReason() !== null || pending()) {
        return
      }
      requested.set(runId)
      void sidecar.prepareFeedback(runId)
    },
  }
}
```

- [ ] **Step 3 : lancer, tout passe, puis lint**

Run : `pnpm exec ng test --watch=false --include src/app/features/tagging/recap/feedback-send.spec.ts && just lint`
Expected : PASS

- [ ] **Step 4 : commit**

```bash
git add src/app/features/tagging/recap/feedback-send.ts src/app/features/tagging/recap/feedback-send.spec.ts
git commit -m "feat(ui): demander l'issue de retour d'un run et l'ouvrir au retour de la seule demande"
```

---

### Task 2 : bouton du pied du récapitulatif

**Files:**
- Modify: `src/app/features/tagging/recap/recap-page.component.ts`
- Modify: `src/app/features/tagging/recap/recap-page.component.html`
- Modify: `src/app/features/tagging/recap/recap-page.component.spec.ts`
- Modify: `public/i18n/fr.json`, `public/i18n/en.json`

**Interfaces:**
- Consumes : `injectFeedbackSend`, `FeedbackTarget` (Task 1) ; `SidecarService.errorFor("prepare_feedback")` ; `WIDE_TOOLTIP` de `shared/utils/tooltip`

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `recap-page.component.spec.ts` (`PAST_RUN`, `TRACK_LOADED`, `loadedTrack` et `hostOf` y sont déjà importés), ajouter un `describe` :

```typescript
  describe("send this report", () => {
    const sendButton = (fixture: { nativeElement: unknown }) =>
      hostOf(fixture).querySelector<HTMLButtonElement>('[data-action="send-report"]')

    it("asks for the issue of the current run", async () => {
      const { fixture, service } = await mountWith([written("a", "Your Mind")], {
        pastRuns: signal([PAST_RUN]),
      })

      sendButton(fixture)?.click()

      expect(service.prepareFeedback).toHaveBeenCalledWith("a3f9c1")
    })

    it("asks for the issue of a past run", async () => {
      const loaded = {
        runId: PAST_RUN.run_id,
        folder: PAST_RUN.folder,
        writtenAt: PAST_RUN.written_at,
        tracks: [loadedTrack(TRACK_LOADED)],
      }
      const { fixture, service } = await mountWith([], { loadedRun: signal(loaded) }, PAST_RUN.run_id)

      sendButton(fixture)?.click()

      expect(service.prepareFeedback).toHaveBeenCalledWith(PAST_RUN.run_id)
    })

    it("greys the button out with its reason when the run has no report", async () => {
      const { fixture, component } = await mountWith([written("a", "Your Mind")], {
        pastRuns: signal([]),
      })

      const button = sendButton(fixture)

      expect(button?.disabled).toBe(true)
      expect(component["feedback"].blockedReason()).toBe("recap.feedback.unavailable")
    })

    it.each<[string, SidecarStubOverrides, string]>([
      ["a run without report", { pastRuns: signal([]) }, "recap.feedback.unavailable"],
      ["a run with its report", { pastRuns: signal([PAST_RUN]) }, "recap.feedback.hint"],
    ])("shows the tooltip of %s on hover", async (_case, overrides, tip) => {
      const { fixture } = await mountWith([written("a", "Your Mind")], overrides)

      sendButton(fixture)?.dispatchEvent(new MouseEvent("mouseenter"))
      vi.advanceTimersByTime(TOOLTIP.showDelay ?? 0)

      expect(document.body.querySelector(".p-tooltip")?.textContent).toBe(tip)
    })

    it.each([
      ["of the run on screen", { run_id: "a3f9c1" }, true],
      ["without any run, a malformed command", {}, true],
      ["of another run", { run_id: "b4c5d6" }, false],
    ])("shows a refusal %s only when it is its own", async (_case, params, shown) => {
      const { fixture } = await mountWith([written("a", "Your Mind")], {
        pastRuns: signal([PAST_RUN]),
        ...commandFailed("prepare_feedback", "feedback_export_write_failed", params),
      })

      const message = hostOf(fixture).querySelector("[data-feedback-error]")

      expect(message !== null).toBe(shown)
    })
  })
```

Imports à ajouter dans le spec : `commandFailed` depuis `../../../../fixtures/sidecar-stub` (déjà importé pour `sidecarStub`) et `TOOLTIP` depuis `../../../shared/utils/tooltip`. Le spec utilise déjà `vi.useFakeTimers()` en `beforeEach` : le tooltip s'ouvre à `TOOLTIP.showDelay`, comme dans `tagging-page.component.spec.ts`.

Run : `pnpm exec ng test --watch=false --include src/app/features/tagging/recap/recap-page.component.spec.ts`
Expected : FAIL, bouton `send-report` absent

- [ ] **Step 2 : traductions**

`public/i18n/fr.json`, section `recap`, après `"back"` (le `\u00a0` s'écrit tel quel dans le fichier, comme les clés voisines) :

```json
    "back": "Retour à la liste",
    "feedback": {
      "send": "Envoyer ce rapport",
      "hint": "Ouvre dans votre navigateur un ticket GitHub public pré-rempli avec les noms de fichiers et les résultats du run, à relire avant de l'envoyer.\nL'Explorateur s'ouvre aussi sur le fichier complet du run, à glisser dans le ticket si vous le souhaitez.",
      "unavailable": "Ce run n'a pas de rapport à envoyer."
    }
```

`public/i18n/en.json`, même emplacement :

```json
    "back": "Back to the list",
    "feedback": {
      "send": "Send this report",
      "hint": "Opens a public GitHub issue in your browser, prefilled with the file names and the results of the run, to review before sending it.\nFile Explorer also opens on the full run file, to drag into the issue if you wish.",
      "unavailable": "This run has no report to send."
    }
```

- [ ] **Step 3 : composant**

`recap-page.component.ts` :
- importer `Tooltip` depuis `primeng/tooltip` et l'ajouter à `imports` ; importer `WIDE_TOOLTIP` depuis `../../../shared/utils/tooltip` ; importer `type FeedbackTarget, injectFeedbackSend` depuis `./feedback-send`
- après `context`, ajouter :

```typescript
  /** Run affiche et son rapport : un run present dans le registre des runs passes en a un. */
  private readonly feedbackTarget = computed<FeedbackTarget | null>(() => {
    const runId = this.past() ? this.runId() : this.sidecar.taggingRunId()

    return runId === undefined || runId === null
      ? null
      : { runId, hasReport: this.written() !== null }
  })
  protected readonly feedback = injectFeedbackSend(this.feedbackTarget)
  private readonly feedbackErrors = this.sidecar.errorFor("prepare_feedback")
  /** Le refus d'un autre run ne s'affiche pas ici ; un refus sans run (commande malformee) s'affiche. */
  protected readonly feedbackError = computed(() => {
    const error = this.feedbackErrors()
    const refusedRun = error?.params["run_id"]

    return error !== null && (refusedRun === undefined || refusedRun === this.feedbackTarget()?.runId)
      ? error
      : null
  })
  protected readonly wideTooltip = WIDE_TOOLTIP
```

`written` est déclaré plus haut dans la classe : le `computed` le lit à la demande, l'ordre des champs ne joue pas.

`recap-page.component.html` :
- après `@if (refusal(); as shown) { ... }` :

```html
@if (feedbackError(); as shown) {
  <app-error-message data-feedback-error [error]="shown" />
}
```

- dans le pied, entre le bouton `back` et `@if (context(); as line)` :

```html
    @let feedbackTip = feedback.blockedReason() ?? "recap.feedback.hint";
    <button
      pButton
      type="button"
      size="small"
      severity="secondary"
      [outlined]="true"
      class="shrink-0 whitespace-nowrap"
      data-action="send-report"
      [disabled]="feedback.blockedReason() !== null"
      [pTooltip]="feedbackTip | translate"
      [tooltipOptions]="wideTooltip"
      (click)="feedback.send()"
    >
      <app-icon [name]="feedback.pending() ? 'spinner' : 'external-link'" [size]="16" />
      {{ "recap.feedback.send" | translate }}
    </button>
```

Le commentaire au-dessus du pied (« Pied comme sous le rapport de Playlist [...] ») gagne : « « Envoyer ce rapport » suit le retour, seul geste qui fait sortir des titres (ADR-014). »

- [ ] **Step 4 : lancer, tout passe, puis lint et typage**

Run : `pnpm exec ng test --watch=false && just lint && just typecheck`
Expected : PASS

- [ ] **Step 5 : commit**

```bash
git add src/app/features/tagging/recap/ public/i18n/fr.json public/i18n/en.json
git commit -m "feat(ui): envoyer le rapport du run depuis le pied du recapitulatif"
```

---

### Task 3 : ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md` (§ Observabilité > Monitoring)

- [ ] **Step 1 : retirer la mention d'absence**

Remplacer « Étape 8 : absent de l'interface au 2026-10-13. » par « Le bouton vit dans le pied du récapitulatif, du run courant comme d'un run passé. »

- [ ] **Step 2 : ligne `opener` du tableau des plugins**

Dans le tableau des plugins Tauri (§ Capacités Natives, ligne `opener`), ajouter à la liste des usages : l'ouverture de l'issue de retour par `openUrl` et la révélation de son export par `revealItemInDir`, au clic de « Envoyer ce rapport ». Aucune permission de plus : `opener:allow-open-url`, `opener:allow-reveal-item-in-dir` et `opener:allow-default-urls` sont déjà déclarées dans `src-tauri/capabilities/default.json`.

- [ ] **Step 3 : commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(ui): bouton d'envoi du rapport livre dans le recapitulatif"
```

---

### Task 4 : gate qualité

- [ ] **Step 1 : lint, typage, tests des trois zones**

Run : `just lint && just typecheck && just test`
Expected : tout vert

- [ ] **Step 2 : passer la spec en `implemented`**

Réservé à `/implement-subproject`, après la chaîne de revue (dont `/verify`, qui ouvre le récapitulatif dans la fenêtre Tauri et clique le bouton).
