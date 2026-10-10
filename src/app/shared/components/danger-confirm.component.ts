import { Component, inject } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"
import { ConfirmationService } from "primeng/api"
import { ConfirmDialog } from "primeng/confirmdialog"

/**
 * Modale des gestes qui touchent aux fichiers musicaux (ecriture, relance, rollback), a poser
 * une fois par ecran. 30rem comme la fiche `ConfirmDialog` ; message interpole et non en
 * `innerHTML`, le chemin d'un dossier y figurant ; focus sur « Annuler » : Entree ne valide rien.
 */
@Component({
  selector: "app-danger-confirm",
  imports: [ConfirmDialog],
  template: `
    <p-confirmdialog styleClass="w-120" defaultFocus="reject">
      <ng-template #message let-confirmation>
        <p class="m-0 text-sm leading-normal text-muted-color">{{ confirmation.message }}</p>
      </ng-template>
    </p-confirmdialog>
  `,
  // Hote vide dans une colonne : ni place ni gap.
  host: { class: "contents" },
})
export class DangerConfirmComponent {}

/** Ouvre la modale `danger` : `<prefix>.header` et `<prefix>.accept` nomment le geste. */
export const injectDangerConfirm = () => {
  const confirmation = inject(ConfirmationService)
  const translate = inject(TranslateService)
  const t = (key: string): string => translate.instant(key) as string

  return (prefix: string, message: string, accept: () => void): void => {
    confirmation.confirm({
      header: t(`${prefix}.header`),
      message,
      acceptLabel: t(`${prefix}.accept`),
      rejectLabel: t("confirm.cancel"),
      acceptButtonProps: { severity: "danger" },
      rejectButtonProps: { severity: "secondary", outlined: true },
      accept,
    })
  }
}
