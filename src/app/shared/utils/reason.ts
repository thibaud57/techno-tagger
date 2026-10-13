import { Pipe, type PipeTransform, inject } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"
import { type Observable, combineLatest, map, of, switchMap } from "rxjs"

import type {
  FileFailureReason,
  RollbackFailureReason,
  TrackFailureReason,
} from "../../core/sidecar/protocol"

/** Ce que l'utilisateur relance pour que le geste qui repare serve : l'ecriture, la restauration, l'extraction. */
export type FileReasonContext = "write" | "rollback" | "extraction"

/**
 * Cles d'un motif. `cause` seule, ou `cause` puis `remedy` sur la ligne suivante : le geste qui
 * repare (`reason.fix.*`) ne dit pas ce qu'il faut relancer, `retry` (`reason.retry.*`) le dit.
 */
export interface ReasonKeys {
  readonly cause: string
  readonly remedy: { readonly fix: string; readonly retry: string } | null
}

/**
 * Vrai quand `reason.fix.<motif>` existe. Un fichier disparu n'en a pas : une restauration
 * l'oublie du dump, la relancer ne le rejoue pas. Une ecriture ratee n'en a pas non plus, sa
 * cause est inconnue.
 */
const FILE_FAILURE_HAS_FIX: Record<FileFailureReason, boolean> = {
  permission_denied: true,
  disk_full: true,
  path_too_long: true,
  file_locked: true,
  file_missing: false,
  write_failed: false,
}

const isFileFailure = (reason: string): reason is FileFailureReason =>
  Object.hasOwn(FILE_FAILURE_HAS_FIX, reason)

const fileReasonKeys = (reason: FileFailureReason, context: FileReasonContext): ReasonKeys => ({
  cause: `reason.${reason}`,
  remedy: FILE_FAILURE_HAS_FIX[reason]
    ? { fix: `reason.fix.${reason}`, retry: `reason.retry.${context}` }
    : null,
})

export const extractionReasonKeys = (reason: FileFailureReason): ReasonKeys =>
  fileReasonKeys(reason, "extraction")

/** Motif d'un morceau : non resolu par la recherche, ou en echec d'ecriture. */
export const trackReasonKeys = (reason: TrackFailureReason): ReasonKeys =>
  isFileFailure(reason)
    ? fileReasonKeys(reason, "write")
    : { cause: `tagging.reason.${reason}`, remedy: null }

export const rollbackReasonKeys = (reason: RollbackFailureReason): ReasonKeys =>
  isFileFailure(reason)
    ? fileReasonKeys(reason, "rollback")
    : { cause: `rollback.reason.${reason}`, remedy: null }

/**
 * Motif rendu en texte : la cause, puis le geste qui repare sur la ligne suivante. Rend un flux,
 * lu par `async` : `stream()` reemet au chargement des traductions et a chaque changement de
 * langue, qu'un `instant()` dans un pipe pur ne verrait jamais.
 */
@Pipe({ name: "reasonText" })
export class ReasonTextPipe implements PipeTransform {
  private readonly translate = inject(TranslateService)

  transform(keys: ReasonKeys | null | undefined): Observable<string> {
    if (!keys) {
      return of("")
    }
    const cause = this.translate.stream(keys.cause) as Observable<string>
    if (!keys.remedy) {
      return cause
    }
    const { fix, retry } = keys.remedy
    const remedy = (this.translate.stream(retry) as Observable<string>).pipe(
      switchMap((text) => this.translate.stream(fix, { retry: text }) as Observable<string>),
    )

    return combineLatest([cause, remedy]).pipe(
      map(
        ([c, r]) => `${c}
${r}`,
      ),
    )
  }
}
