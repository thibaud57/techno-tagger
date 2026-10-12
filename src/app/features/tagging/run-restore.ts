import { computed, inject } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"

import type { RollbackFailure } from "../../core/models/protocol"
import { SidecarService } from "../../core/sidecar.service"
import { injectDangerConfirm } from "../../shared/components/danger-confirm.component"

/** « Restaurer le run » et « Restaurer ce morceau », partages par la liste du run et son recapitulatif. */
export const injectRunRestore = () => {
  const sidecar = inject(SidecarService)
  const translate = inject(TranslateService)
  const confirmDanger = injectDangerConfirm()

  /** Lignes que le dump peut rendre : le sidecar le dit par ligne, l'interface ne le deduit pas de l'etat. */
  const restorableIds = computed<ReadonlySet<string>>(
    () =>
      new Set(
        sidecar
          .taggingTracks()
          .filter((track) => track.restorable)
          .map((track) => track.trackId),
      ),
  )
  const canRestoreRun = computed(() => !sidecar.writing() && restorableIds().size > 0)
  /** Run affiche seulement : celui des Reglages ne fait pas tourner ce bouton. */
  const restoringRun = computed(() => {
    const inFlight = sidecar.rollingBack()

    return inFlight?.trackId === null && inFlight.runId === sidecar.taggingRunId()
  })
  const restoringTrackId = computed(() => sidecar.rollingBack()?.trackId ?? null)
  /** Le bilan ne vaut que pour le run qu'il nomme. */
  const runRollbackFailures = computed<readonly RollbackFailure[]>(() => {
    const finished = sidecar.rollbackFinished()

    return finished !== null && finished.run_id === sidecar.taggingRunId() ? finished.failed : []
  })

  /** Sans `trackId`, tout le run. */
  const restore = (count: number, ...trackId: [] | [string]): void => {
    const runId = sidecar.taggingRunId()
    if (runId === null || sidecar.filesBusy()) {
      return
    }
    confirmDanger(
      "tagging.rollback",
      translate.instant("tagging.rollback.message", { count }) as string,
      () => {
        void sidecar.rollback(runId, ...trackId)
      },
      true,
    )
  }

  return {
    restorableIds,
    canRestoreRun,
    restoringRun,
    restoringTrackId,
    runRollbackFailures,
    restoreRun: (): void => {
      restore(restorableIds().size)
    },
    restoreTrack: (trackId: string): void => {
      restore(1, trackId)
    },
  }
}
