import { InjectionToken, Type, inject } from "@angular/core"

export type AppEdition = "desktop" | "demo"

export const APP_EDITION = new InjectionToken<AppEdition>("AppEdition", {
  providedIn: "root",
  factory: () => "desktop",
})

/** Raison de blocage d'une action que la demo ne branche pas. */
export const DEMO_UNAVAILABLE = "demo.unavailable"

/** `null` en desktop ; a appeler dans un contexte d'injection. */
export const injectDemoReason = (): typeof DEMO_UNAVAILABLE | null =>
  inject(APP_EDITION) === "demo" ? DEMO_UNAVAILABLE : null

/** Bandeau affiche par la coquille : `null` en desktop, fourni par la seule edition demo. */
export const APP_BANNER = new InjectionToken<Type<unknown> | null>("AppBanner", {
  providedIn: "root",
  factory: () => null,
})
