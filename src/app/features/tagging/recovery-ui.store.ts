import { Injectable, computed, inject, signal } from "@angular/core"

import { SidecarService } from "../../core/sidecar.service"

/**
 * Etat d'interface du rattrapage par lien, partage par la modale du lien, l'etape lien de
 * l'arbitrage et le badge du shell. Aucun etat du sidecar ici : seulement ce que
 * l'utilisateur a colle et ce qu'il a ouvert.
 */
@Injectable({ providedIn: "root" })
export class RecoveryUiStore {
  private readonly sidecar = inject(SidecarService)

  /**
   * Lien colle par morceau, garde apres un succes pour qu'on voie et corrige le lien utilise.
   * Rattache a son run comme le refus : les identifiants de morceau se repetent d'un run a l'autre.
   */
  private readonly _drafts = signal<{
    readonly runId: string | null
    readonly urls: ReadonlyMap<string, string>
  }>({ runId: null, urls: new Map() })
  private readonly _target = signal<string | null>(null)
  /**
   * Morceau dont l'utilisateur vient de refuser les candidats, avec son run : un run suivant
   * reprend les memes identifiants et ne doit pas rouvrir l'etape lien d'un ancien refus.
   */
  private readonly _refused = signal<{
    readonly runId: string | null
    readonly trackId: string
  } | null>(null)

  /** Morceau ouvert dans la modale du lien, `null` : modale fermee. */
  readonly target = this._target.asReadonly()
  /** Le sidecar refuse le geste tant que le run tourne : le champ reste visible, desactive. */
  readonly available = computed(() => !this.sidecar.tagging())
  readonly unresolvedCount = computed(
    () => this.sidecar.recoverableTracks().filter((track) => track.state === "unresolved").length,
  )

  /**
   * Morceau de l'etape lien de l'arbitrage. Le refus ne suffit pas : il faut que le sidecar
   * l'ait retire de la file et rendu non resolu, une liste Bandcamp pouvant encore suivre.
   */
  readonly linkStep = computed(() => {
    const refused = this._refused()
    if (refused === null) {
      return null
    }
    const { runId, trackId } = refused
    if (runId !== this.sidecar.taggingRunId()) {
      return null
    }
    if (this.sidecar.arbitrations().some((entry) => entry.track_id === trackId)) {
      return null
    }
    // Pas de filtre sur le motif : « Passer » sur une liste Bandcamp vide rend celui de la liste.
    const row = this.sidecar.taggingTracks().find((track) => track.trackId === trackId)

    return row?.state === "unresolved" ? trackId : null
  })

  draft(trackId: string): string {
    const drafts = this._drafts()
    return drafts.runId === this.sidecar.taggingRunId() ? (drafts.urls.get(trackId) ?? "") : ""
  }

  edit(trackId: string, url: string): void {
    const runId = this.sidecar.taggingRunId()
    this._drafts.update((drafts) => ({
      runId,
      urls: new Map(drafts.runId === runId ? drafts.urls : []).set(trackId, url),
    }))
  }

  isBusy(trackId: string): boolean {
    return this.sidecar.urlRecoveryBusy().has(trackId)
  }

  canResolve(trackId: string): boolean {
    return this.available() && !this.isBusy(trackId) && this.draft(trackId) !== ""
  }

  /** La garde double celle du bouton : la touche Entree ne passe pas par `[disabled]`. */
  resolve(trackId: string): void {
    if (this.canResolve(trackId)) {
      void this.sidecar.resolveByUrl(trackId, this.draft(trackId))
    }
  }

  /** Sans morceau designe, le premier encore non resolu : le badge ne s'affiche qu'avec un. */
  open(trackId?: string): void {
    const target =
      trackId ??
      this.sidecar.recoverableTracks().find((track) => track.state === "unresolved")?.trackId
    this._target.set(target ?? null)
  }

  close(): void {
    this._target.set(null)
  }

  refused(trackId: string): void {
    this._refused.set({ runId: this.sidecar.taggingRunId(), trackId })
  }

  leaveLinkStep(): void {
    this._refused.set(null)
  }
}
