import { Component, computed, inject, signal } from "@angular/core"
import { FormField, form } from "@angular/forms/signals"
import { Router } from "@angular/router"
import { TranslatePipe, TranslateService } from "@ngx-translate/core"
import { ButtonDirective } from "primeng/button"
import { IconField } from "primeng/iconfield"
import { InputIcon } from "primeng/inputicon"
import { InputText } from "primeng/inputtext"
import { SelectButton } from "primeng/selectbutton"
import { Tooltip } from "primeng/tooltip"

import { SidecarService } from "../../core/sidecar.service"
import { DangerConfirmComponent } from "../../shared/components/danger-confirm.component"
import { EmptyStateComponent } from "../../shared/components/empty-state.component"
import { IconComponent } from "../../shared/components/icon.component"
import { MessageComponent } from "../../shared/components/message.component"
import { RollbackFailuresComponent } from "../../shared/components/rollback-failures.component"
import { FADE_IN, PAGE_HOST } from "../../shared/utils/motion"
import { TOOLTIP } from "../../shared/utils/tooltip"

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

/** Recapitulatif du run affiche (maquette `Recap`) ; la relance reste au bouton d'action de la liste. */
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
    Tooltip,
    DangerConfirmComponent,
    EmptyStateComponent,
    IconComponent,
    MessageComponent,
    RollbackFailuresComponent,
    RunListComponent,
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
  protected readonly tooltip = TOOLTIP

  protected readonly tracks = this.sidecar.taggingTracks
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

  protected backToList(): void {
    void this.router.navigateByUrl("/tagging")
  }

  protected newRun(): void {
    this.sidecar.clearRun()
    void this.router.navigateByUrl("/tagging")
  }
}
