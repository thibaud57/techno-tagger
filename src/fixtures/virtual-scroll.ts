import { vi } from "vitest"

/**
 * Sans ces mesures, JSDOM n'en calculant aucune, `[virtualScroll]` ne monte pas une seule ligne.
 * Par `vi.spyOn` et non `Object.defineProperty` : `vi.restoreAllMocks()` le retire, sinon un stub
 * sur le prototype fuirait vers les tests suivants du fichier (`showOnEllipsis` de `pTooltip`,
 * entre autres).
 */
export const stubOffscreenLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body)
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800)
}

/**
 * Laisse le scroller digerer un montage, un changement d'entree ou un clic, sous
 * `vi.useFakeTimers()`. `fixture.whenStable()` n'y est plus appele : sous faux timers il ne se
 * resout pas (timeout de 5 s mesure le 2026-10-11).
 */
export const settleScroller = async (fixture: { detectChanges: () => void }): Promise<void> => {
  await vi.advanceTimersByTimeAsync(1)
  fixture.detectChanges()
}
