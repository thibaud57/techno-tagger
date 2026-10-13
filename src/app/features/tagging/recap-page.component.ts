import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputText } from "primeng/inputtext"
import { SelectButton } from "primeng/selectbutton"

import { SidecarService } from "../../core/sidecar.service"
import { DangerConfirmComponent } from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { ErrorMessageComponent } from "../../shared/components/error-message.component"
import { IconComponent } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { TruncatedTextComponent } from "../../shared/components/truncated-text.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { runDate } from "../../shared/utils/run-date"

import {
  inFilter,
  matchesSearch,
  RECAP_FILTERS,
  recapCounts,
  type RecapFilter,
} from "./recap-filter"
import { RunListComponent } from "./run-list.component"
import { injectRunRestore } from "./run-restore"

interface RecapCriteria {
  filter: RecapFilter
  query: string
}

/**
 * Recapitulatif du run affiche (maquette `Recap`) ou, avec `runId`, d'un run passe relu dans son
 * rapport, en lecture seule. La relance reste au bouton d'action de la liste.
 */
@Component({
  selector: "app-recap-page",
  imports: [
    TranslatePipe,
    FormField,
    ButtonDirective,
    IconField,
    InputIcon,
    InputText,
    SelectButton,
    DangerConfirmComponent,
    EmptyStateComponent,
    ErrorMessageComponent,
    IconComponent,
    MessageComponent,
    RollbackFailuresComponent,
    RunListComponent,
    TruncatedTextComponent,
  ],
  templateUrl: "./recap-page.component.html",
  host: { class: PAGE_HOST, "animate.enter": FADE_IN },
})
export default class RecapPageComponent {
  private readonly sidecar = inject(SidecarService)
  private readonly router = inject(Router)
  private readonly translate = inject(TranslateService)

  protected readonly runRestore = injectRunRestore()

  /** Filtre et recherche en un seul signal : `form()` en derive les champs que `[formField]` lie. */
  protected readonly criteria = signal<RecapCriteria>({ filter: "all", query: "" })
  protected readonly fields = form(this.criteria)

  /** Lie par le Router (`withComponentInputBinding`) : un run passe, sinon le run affiche. */
  readonly runId = input<string>()

  protected readonly past = computed(() => this.runId() !== undefined)
  /** Le run charge ne vaut que pour le `runId` de la route : un autre ne s'affiche pas sous son nom. */
  protected readonly loaded = computed(() => {
    const run = this.sidecar.loadedRun()

    return run !== null && run.runId === this.runId() ? run : null
  })
  /** Le refus porte son run : celui d'un autre run, arrive plus tard, ne s'affiche pas ici. */
  protected readonly refusal = computed(() => {
    const refused = this.sidecar.loadRefusal()

    return refused !== null && refused.runId === this.runId() ? refused.error : null
  })
  /** Tant que le run n'est ni charge ni refuse : le squelette occupe la table, jamais l'etat vide. */
  protected readonly loading = computed(
    () => this.past() && this.loaded() === null && this.refusal() === null,
  )
  protected readonly tracks = computed(() =>
    this.past() ? (this.loaded()?.tracks ?? []) : this.sidecar.taggingTracks(),
  )
  /** Le run affiche se date par la cible de restauration, demandee juste apres son ecriture. */
  private readonly written = computed(() => {
    if (this.past()) {
      return this.loaded()
    }
    const target = this.sidecar.rollbackTarget()

    return target?.run_id === this.sidecar.taggingRunId()
      ? { writtenAt: target.written_at, folder: target.folder }
      : null
  })
  protected readonly context = computed(() => {
    const run = this.written()

    return run === null
      ? null
      : { date: runDate(run.writtenAt, this.translate.currentLang()), folder: run.folder }
  })
  /** Lecture seule : les fichiers d'un run passe ont pu etre retagues depuis. */
  protected readonly restorableIds = computed<ReadonlySet<string>>(() =>
    this.past() ? new Set<string>() : this.runRestore.restorableIds(),
  )
  protected readonly filesBusy = this.sidecar.filesBusy
  protected readonly writing = this.sidecar.writing
  /** Compte sur les morceaux affiches : un morceau restaure sort du message. */
  protected readonly writeFailures = this.sidecar.writeFailureCount
  protected readonly counts = computed(() => recapCounts(this.tracks()))
  /** `label` : PrimeNG le pose en `aria-label` de chaque bouton, faute de quoi il y met l'objet. */
  protected readonly options = computed(() => {
    // `currentLang()` est lu pour que les libelles suivent la langue : `instant` ne notifie rien.
    void this.translate.currentLang()
    const counts = this.counts()

    return RECAP_FILTERS.map((value) => {
      const name = this.translate.instant(`recap.filter.${value}`) as string

      return { value, name, count: counts[value], label: `${name} ${counts[value]}` }
    })
  })
  protected readonly visible = computed(() => {
    const { filter, query } = this.criteria()

    return this.tracks().filter((track) => inFilter(track, filter) && matchesSearch(track, query))
  })

  constructor() {
    // Une commande par instance de la page : l'effet ne se rejoue que si `runId` ou la disponibilite
    // du moteur change. `loadRun` ne renvoie pas un run deja en vol.
    effect(() => {
      const runId = this.runId()
      if (runId !== undefined && this.sidecar.available() === true) {
        untracked(() => void this.sidecar.loadRun(runId))
      }
    })
  }

  protected backToList(): void {
    void this.router.navigateByUrl("/tagging")
  }
}
