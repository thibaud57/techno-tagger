/** La part commune d'un `progress` d'extraction et d'un compteur de run. */
interface Counted {
  readonly processed: number
  readonly total: number
}

/**
 * Pourcentage d'une phase, ou `undefined` pour la barre indeterminee de PrimeNG.
 *
 * Un total nul n'est pas une phase vide mais une phase dont le compte n'est pas
 * encore connu : la division rendrait `NaN`, que `p-progressbar` affiche tel quel.
 */
export const progressPercentage = (progress: Counted | null): number | undefined =>
  progress === null || progress.total === 0
    ? undefined
    : Math.round((progress.processed / progress.total) * 100)
