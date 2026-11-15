import { vi } from "vitest"

/** Coupe `console.error` pour un test qui provoque l'erreur attendue ; `restoreAllMocks` le rend. */
export const silenceConsoleError = () =>
  vi.spyOn(console, "error").mockImplementation(() => undefined)
