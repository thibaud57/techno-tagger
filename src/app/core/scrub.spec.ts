import { MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin.
 */
describe("scrub", () => {
  it("masks the username in all three path forms, at any depth", () => {
    const event = {
      message: "cannot read C:\\Users\\thibaud\\Music\\set.flac",
      extra: {
        posix: "/home/thibaud/Music/set.flac",
        macos: "/Users/thibaud/Music/set.flac",
        tracks: 42,
      },
    }

    const scrubbed = scrub(event as never, {}) as unknown as Record<string, unknown>

    expect(scrubbed["message"]).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`)
    expect(scrubbed["extra"]).toEqual({
      posix: `/home/${MASK}/Music/set.flac`,
      macos: `/Users/${MASK}/Music/set.flac`,
      tracks: 42,
    })
  })

  it("masks an account name containing a space", () => {
    const event = { message: "cannot read C:\\Users\\Jean Dupont\\Music\\set.flac" }

    const scrubbed = scrub(event as never, {}) as unknown as Record<string, unknown>

    expect(scrubbed["message"]).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`)
  })

  it("masks an account name containing an apostrophe", () => {
    const event = { message: "cannot read C:\\Users\\O'Brien\\Music\\set.flac" }

    const scrubbed = scrub(event as never, {}) as unknown as Record<string, unknown>

    expect(scrubbed["message"]).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`)
  })

  it("masks a mapping key as well as its value", () => {
    const event = { extra: { "C:\\Users\\thibaud\\Music": "locked" } }

    const scrubbed = scrub(event as never, {}) as unknown as Record<string, unknown>

    expect(scrubbed["extra"]).toEqual({ [`C:\\Users\\${MASK}\\Music`]: "locked" })
  })

  it("masks every path in an array", () => {
    const event = {
      extra: {
        paths: ["C:\\Users\\thibaud\\Music\\a.flac", "C:\\Users\\thibaud\\Music\\b.flac"],
      },
    }

    const scrubbed = scrub(event as never, {}) as unknown as Record<string, unknown>

    expect(scrubbed["extra"]).toEqual({
      paths: [`C:\\Users\\${MASK}\\Music\\a.flac`, `C:\\Users\\${MASK}\\Music\\b.flac`],
    })
  })
})
