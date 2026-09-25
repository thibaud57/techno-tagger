import type { TablePassThrough } from "primeng/table"

/**
 * `h-full` sur une table remplie etirerait ses lignes pour occuper toute la hauteur.
 * La cellule du `#emptymessage` pose `border-b-0` elle-meme : le pass-through n'atteint pas les lignes.
 * `table-fixed` : en disposition auto, les largeurs de l'en-tete ne sont qu'indicatives et les
 * colonnes suivent le contenu des lignes montees, que le defilement virtuel renouvelle sans cesse.
 */
export const fullHeightTable = (empty: boolean): TablePassThrough => ({
  tableContainer: { class: "bg-(--p-datatable-row-background)" },
  table: { class: `table-fixed${empty ? " h-full" : ""}` },
})
