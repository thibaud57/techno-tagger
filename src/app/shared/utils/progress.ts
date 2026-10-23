/** La part commune d'un `progress` d'extraction et d'un compteur de run. */
interface Counted {
  readonly processed: number
  readonly total: number
}

/**
 * Pourcentage d'une phase, `undefined` pour la barre indeterminee de PrimeNG : un total nul est un
 * compte pas encore connu, et la division rendrait `NaN`, que `p-progressbar` affiche tel quel.
 */
export const progressPercentage = (progress: Counted | null): number | undefined =>
  progress === null || progress.total === 0
    ? undefined
    : Math.round((progress.processed / progress.total) * 100)
