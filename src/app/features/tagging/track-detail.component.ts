import { Component, computed, input } from "@angular/core"
import { TranslatePipe } from "@ngx-translate/core"
import { convertFileSrc } from "@tauri-apps/api/core"

import type { TagField, TagValue } from "../../core/models/protocol"
import type { TaggingTrack } from "../../core/tagging-run.store"
import { ArtworkComponent } from "../../shared/components/artwork.component"
import { NoValueComponent } from "../../shared/components/no-value.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"

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

/** Détail d'un morceau déplié (maquette `TrackDetail`) ; ordre et clés viennent du sidecar. */
@Component({
  selector: "app-track-detail",
  imports: [TranslatePipe, ArtworkComponent, NoValueComponent, TruncatedTextComponent],
  templateUrl: "./track-detail.component.html",
  host: { class: "block" },
})
export class TrackDetailComponent {
  readonly track = input.required<TaggingTrack>()
  /** Run arrêté avant ce morceau : sa pochette ne viendra plus, pas de squelette. */
  readonly interrupted = input(false)

  protected readonly artworkUrl = computed(() => {
    const path = this.track().artworkPath

    return path === null ? null : convertFileSrc(path)
  })
  protected readonly pending = computed(() => this.track().state === null && !this.interrupted())
  /** `null` : ni avant ni après, le fichier n'a pas pu être lu et n'a pas été résolu. */
  protected readonly rows = computed<readonly DetailRow[] | null>(() => {
    const { tagsBefore, tagsAfter } = this.track()
    const base = tagsBefore?.fields ?? tagsAfter
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
