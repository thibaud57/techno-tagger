import { InjectionToken } from "@angular/core"

/**
 * Lien a pre-remplir pour un morceau, `null` sans indice. Vide en desktop : seule la demo, qui
 * rejoue des reponses enregistrees, sait quel lien elle peut resoudre.
 */
export const RECOVERY_URL_HINT = new InjectionToken<(trackId: string) => string | null>(
  "RecoveryUrlHint",
  { providedIn: "root", factory: () => () => null },
)
