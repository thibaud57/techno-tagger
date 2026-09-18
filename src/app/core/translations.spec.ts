import en from "../../../public/i18n/en.json"
import fr from "../../../public/i18n/fr.json"

import { SIDECAR_UNAVAILABLE } from "./sidecar.service"

/** Enrichir un seul fichier ne casse rien : le manque ne se verrait qu'a l'ecran, en cle brute. */
describe("language files", () => {
  function leaves(source: Record<string, unknown>, prefix = ""): [string, unknown][] {
    return Object.entries(source).flatMap(([key, value]) =>
      typeof value === "object" && value !== null
        ? leaves(value as Record<string, unknown>, `${prefix}${key}.`)
        : ([[`${prefix}${key}`, value]] as [string, unknown][]),
    )
  }

  function flatten(source: Record<string, unknown>): string[] {
    return leaves(source).map(([key]) => key)
  }

  it("carry exactly the same keys", () => {
    expect(flatten(fr).sort()).toEqual(flatten(en).sort())
  })

  it("leave no empty value at any depth", () => {
    const empties = [...leaves(fr), ...leaves(en)].filter(([, value]) => value === "")

    expect(empties).toEqual([])
  })

  it("translate the error the interface raises itself", () => {
    expect([en.errors[SIDECAR_UNAVAILABLE], fr.errors[SIDECAR_UNAVAILABLE]]).not.toContain(
      undefined,
    )
  })
})
