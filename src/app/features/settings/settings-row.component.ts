import { Component } from "@angular/core"

/**
 * Rangee d'une section des Reglages, sur les colonnes de `settings-rows` (subgrid) : libelle, controle,
 * action. Les boutons d'une section partagent la largeur de la colonne d'actions.
 */
@Component({
  selector: "app-settings-row",
  template: `
    <ng-content select="[rowLabel]" />
    <!-- 16px entre les colonnes par un padding des cellules et non un gap de la grille : une section
         sans action garde son controle au bout de la ligne, la troisieme colonne restant vide. -->
    <!-- flex-col : une aide en span y devient un bloc, a l'interligne de son text-xs et non a celui
         de la rangee, donc centree sur la ligne du bouton. -->
    <div class="flex min-w-0 flex-col pl-4">
      <ng-content select="[rowControl]" />
    </div>
    <div class="hidden min-w-0 pl-4 has-[*]:grid">
      <ng-content select="[rowAction]" />
    </div>
    <!-- Une aide colle au controle (pt-2). Un retour en garde 12px, comme le py-3 de la rangee :
         gap-3 apres une aide, mt-1 en premier (DESIGN.md § Feedback et chargement). Masque tant
         qu'il est vide. -->
    <div
      class="col-span-2 col-start-2 hidden min-w-0 flex-col gap-3 pt-2 pl-4 has-[*]:flex [&>app-error-message:first-child]:mt-1 [&>app-message:first-child]:mt-1 [&>app-rollback-failures:first-child]:mt-1"
    >
      <ng-content />
    </div>
  `,
  host: {
    class: "col-span-full grid grid-cols-subgrid items-center border-b border-surface-800 py-3",
  },
})
export class SettingsRowComponent {}
