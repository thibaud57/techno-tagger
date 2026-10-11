import { Component } from "@angular/core"

/**
 * Rangee des Reglages : libelle dans une colonne commune a toutes les rangees, pour que leurs
 * controles s'alignent, controle au bout de la ligne, aide et retours dessous sur sa largeur.
 */
@Component({
  selector: "app-settings-row",
  template: `
    <ng-content select="[rowLabel]" />
    <ng-content select="[rowControl]" />
    <!-- Une aide colle au controle (pt-2). Un retour en garde 12px, comme le py-3 de la rangee
         sous lui : gap-3 apres une aide, mt-1 en premier (DESIGN.md § Feedback et chargement).
         Masque tant qu'il n'a aucun element. -->
    <div
      class="col-start-2 hidden min-w-0 flex-col gap-3 pt-2 has-[*]:flex [&>app-error-message:first-child]:mt-1 [&>app-rollback-failures:first-child]:mt-1"
    >
      <ng-content />
    </div>
  `,
  // 16rem : colonne des libelles, a remesurer sur le plus long en FR et en EN.
  host: {
    class: "grid grid-cols-[16rem_minmax(0,1fr)] items-center gap-x-4 border-b border-surface py-3",
  },
})
export class SettingsRowComponent {}
