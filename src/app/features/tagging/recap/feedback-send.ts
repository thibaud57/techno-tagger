import { type Signal, computed, effect, inject, signal, untracked } from "@angular/core"

import { injectDemoReason } from "../../../core/platform/app-edition"
import { NativeService } from "../../../core/platform/native.service"
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
const openFeedback = async (native: NativeService, ready: FeedbackReadyEvent): Promise<void> => {
  try {
    await native.openUrl(ready.url)
  } catch (error: unknown) {
    console.error("[recap] issue de retour non ouverte", error)
  }
  try {
    await native.revealItemInDir(ready.export_path)
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
  const native = inject(NativeService)
  const demoReason = injectDemoReason()
  const requested = signal<string | null>(null)

  const blockedReason = computed(() => {
    if (demoReason !== null) {
      return demoReason
    }
    if (sidecar.available() !== true) {
      return "settings.admin.starting"
    }

    return target()?.hasReport === true ? null : "recap.feedback.unavailable"
  })
  const pending = computed(() => sidecar.feedbackPending() === target()?.runId)

  effect(() => {
    const ready = sidecar.feedbackReady()
    if (ready?.run_id !== untracked(requested)) {
      return
    }
    requested.set(null)
    void openFeedback(native, ready)
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
