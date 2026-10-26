import { Component, computed, inject, input, output } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import { injectDemoReason } from "../../../core/platform/app-edition"
import { NativeService } from "../../../core/platform/native.service"
import type { TagField, TagValue, TrackSource } from "../../../core/sidecar/protocol"
import type { TaggingTrack } from "../../../core/stores/tagging-run.store"
import { ArtworkComponent } from "../../../shared/components/display/artwork.component"
import { IconComponent } from "../../../shared/components/display/icon.component"
import { NoValueComponent } from "../../../shared/components/display/no-value.component"
import { SourceLabelComponent } from "../../../shared/components/display/source-label.component"
import { TruncatedTextComponent } from "../../../shared/components/display/truncated-text.component"
import { isTrackSource } from "../../../shared/utils/sources"
import { TOOLTIP } from "../../../shared/utils/tooltip"

import type { RunRow } from "./run-list.component"

/** Une ligne de la grille ; `key` nulle pour le commentaire, qui n'a pas de champ écrit. */
interface DetailRow {
  readonly labelKey: string
  readonly key: string | null
  /** Fiche de la source, ouverte depuis la ligne URL ; nulle sur toute autre ligne. */
  readonly link: string | null
  readonly before: string | null
  readonly after: string | null
  /** Ligne Source : la valeur du contrat, montrée par son logo et son nom de marque. */
  readonly beforeSource: TrackSource | null
  readonly afterSource: TrackSource | null
}

const sourceOf = (field: string, value: string | null): TrackSource | null =>
  field === "source" && isTrackSource(value) ? value : null

/** Écrit dans le fichier mais sans intérêt à l'écran (DESIGN.md § Arbitrages). */
const HIDDEN_FIELD: TagField = "source_id"

const valuesOf = (fields: readonly TagValue[] | null | undefined): Map<string, string | null> =>
  new Map(fields?.map((field) => [field.field, field.value]))

/** Grille de base : les tags d'origine, sinon ceux écrits ; `null` quand ni l'un ni l'autre n'existe. */
const fieldsOf = (track: TaggingTrack): readonly TagValue[] | null =>
  track.tagsBefore?.fields ?? track.tagsAfter

/**
 * Lignes de la liste du run (56px) que le détail occupe sous son morceau, mesurées en `text-xs`
 * (le 2026-10-10, 377px pour 16 lignes de champs) : les 15 lignes au plus tiennent dans 7, le bouton
 * « Restaurer » sous la pochette de 168px n'en demande pas de plus, la phrase des tags illisibles
 * tient à côté d'elle dans 4. À remesurer si la grille change ; au-delà, le détail défile.
 */
const DETAIL_SPANS = { unreadable: 4, fields: 7 } as const

export const MAX_DETAIL_SPAN = Math.max(...Object.values(DETAIL_SPANS))

export const detailSpan = (track: TaggingTrack): number =>
  fieldsOf(track) === null ? DETAIL_SPANS.unreadable : DETAIL_SPANS.fields

/** Détail d'un morceau déplié (maquette `TrackDetail`) ; ordre et clés viennent du sidecar. */
@Component({
  selector: "app-track-detail",
  imports: [
    TranslatePipe,
    ButtonDirective,
    Tooltip,
    ArtworkComponent,
    IconComponent,
    NoValueComponent,
    SourceLabelComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./track-detail.component.html",
  host: { class: "block" },
})
export class TrackDetailComponent {
  private readonly native = inject(NativeService)

  /** Les URLs de la demo sont fictives, et la restauration n'y a rien a restaurer. */
  protected readonly demoReason = injectDemoReason()

  protected readonly tooltip = TOOLTIP

  readonly track = input.required<RunRow>()
  /** Une écriture ou une restauration tourne : le moteur n'en accepte qu'une à la fois. */
  readonly blocked = input(false)
  readonly restore = output<string>()

  /** La demo d'abord : elle prime sur le blocage d'une ecriture ou d'une restauration en cours. */
  protected readonly restoreReason = computed(
    () => this.demoReason ?? (this.blocked() ? "tagging.rollback.blocked" : null),
  )

  /** `null` : ni avant ni après, le fichier n'a pas pu être lu et n'a pas été résolu. */
  protected readonly rows = computed<readonly DetailRow[] | null>(() => {
    const track = this.track()
    const { tagsBefore, tagsAfter } = track
    const base = fieldsOf(track)
    if (base === null) {
      return null
    }
    const before = valuesOf(tagsBefore?.fields)
    const after = valuesOf(tagsAfter)
    const shown = base.filter(({ field }) => field !== HIDDEN_FIELD)
    const rows: DetailRow[] = shown.map(({ field, key }) => ({
      labelKey: `tagging.detail.field.${field}`,
      key,
      link: field === "url" ? track.sourceUrl : null,
      before: before.get(field) ?? null,
      after: after.get(field) ?? null,
      beforeSource: sourceOf(field, before.get(field) ?? null),
      afterSource: sourceOf(field, after.get(field) ?? null),
    }))
    const comment = tagsBefore?.comment ?? null
    if (comment !== null) {
      // L'écriture supprime tout commentaire : son Après est toujours vide.
      rows.push({
        labelKey: "tagging.detail.field.comment",
        key: null,
        link: null,
        before: comment,
        after: null,
        beforeSource: null,
        afterSource: null,
      })
    }

    return rows
  })

  /** Le navigateur par défaut : la webview n'ouvre aucune page externe. */
  protected openSource(url: string): void {
    this.native.openUrl(url).catch((error: unknown) => {
      console.error("[track-detail] fiche source non ouverte", error)
    })
  }
}
