import { Component } from "@angular/core"

/** Libelle dans une colonne commune a toutes les rangees pour aligner les controles ; aide et retours sous le controle, a sa largeur. */
@Component({
  selector: "app-settings-row",
  template: `
    <ng-content select="[rowLabel]" />
    <ng-content select="[rowControl]" />
    <!-- Une aide colle au controle (pt-2). Un retour en garde 12px, comme le py-3 de la rangee
         sous lui : gap-3 apres une aide, mt-1 en premier (DESIGN.md § Feedback et chargement).
         Masque tant qu'il n'a aucun element. -->
    <div
      class="col-start-2 hidden min-w-0 flex-col gap-3 pt-2 has-[*]:flex [&>app-error-message:first-child]:mt-1 [&>app-message:first-child]:mt-1 [&>app-rollback-failures:first-child]:mt-1"
    >
      <ng-content />
    </div>
  `,
  // 10rem : colonne des libelles, mesuree sur « Signal sonore de fin », le plus long en FR et en
  // EN. Plus large, elle laisse un vide sous chaque libelle court.
  host: {
    class: "grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-4 border-b border-surface py-3",
  },
})
export class SettingsRowComponent {}
