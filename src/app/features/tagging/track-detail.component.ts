import { Component, computed, input, output } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { Tooltip } from "primeng/tooltip"

import type { TagField, TagValue } from "../../core/models/protocol"
import type { TaggingTrack } from "../../core/tagging-run.store"
import { ArtworkComponent } from "../../shared/components/artwork.component"
import { IconComponent } from "../../shared/components/icon.component"
import { NoValueComponent } from "../../shared/components/no-value.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { TOOLTIP } from "../../shared/utils/tooltip"

import type { RunRow } from "./run-list.component"

/** Une ligne de la grille ; `key` nulle pour le commentaire, qui n'a pas de champ écrit. */
interface DetailRow {
  readonly labelKey: string
  readonly key: string | null
  readonly before: string | null
  readonly after: string | null
}

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
 * « Restaurer » en demande une de plus, la phrase des tags illisibles tient à côté de la
 * pochette de 160px dans 4. À remesurer si la grille change ; au-delà, le détail défile.
 */
const DETAIL_SPANS = { unreadable: 4, fields: 7, restorable: 8 } as const

export const MAX_DETAIL_SPAN = Math.max(...Object.values(DETAIL_SPANS))

export const detailSpan = (track: TaggingTrack, restorable: boolean): number => {
  if (fieldsOf(track) === null) {
    return DETAIL_SPANS.unreadable
  }

  return restorable ? DETAIL_SPANS.restorable : DETAIL_SPANS.fields
}

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
    TruncatedTextComponent,
  ],
  templateUrl: "./track-detail.component.html",
  host: { class: "block" },
})
export class TrackDetailComponent {
  protected readonly tooltip = TOOLTIP

  readonly track = input.required<RunRow>()
  /** Morceau écrit ou en échec d'un run confirmé : le dump peut le rendre. */
  readonly restorable = input(false)
  readonly restoring = input(false)
  /** Une écriture ou une restauration tourne : le moteur n'en accepte qu'une à la fois. */
  readonly blocked = input(false)
  readonly restore = output<string>()

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
      before: before.get(field) ?? null,
      after: after.get(field) ?? null,
    }))
    const comment = tagsBefore?.comment ?? null
    if (comment !== null) {
      // L'écriture supprime tout commentaire : son Après est toujours vide.
      rows.push({
        labelKey: "tagging.detail.field.comment",
        key: null,
        before: comment,
        after: null,
      })
    }

    return rows
  })
}
