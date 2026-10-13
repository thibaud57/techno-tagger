import { MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin.
 */
describe("scrub", () => {
  const scrubbed = (event: object): Record<string, unknown> =>
    scrub(event as never, {}) as unknown as Record<string, unknown>

  it("masks the username in all three path forms, at any depth", () => {
    const event = {
      message: "cannot read C:\\Users\\jane\\Music\\set.flac",
      extra: {
        posix: "/home/jane/Music/set.flac",
        macos: "/Users/jane/Music/set.flac",
        tracks: 42,
      },
    }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`)
    expect(result["extra"]).toEqual({
      posix: `/home/${MASK}/Music/set.flac`,
      macos: `/Users/${MASK}/Music/set.flac`,
      tracks: 42,
    })
  })

  it.each([
    ["a space", "Jean Dupont"],
    ["an apostrophe", "O'Brien"],
  ])("masks an account name containing %s", (_case, account) => {
    const event = { message: `cannot read C:\\Users\\${account}\\Music\\set.flac` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read C:\\Users\\${MASK}\\Music\\set.flac`)
  })

  it("masks a mapping key as well as its value", () => {
    const event = { extra: { "C:\\Users\\jane\\Music": "locked" } }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ [`C:\\Users\\${MASK}\\Music`]: "locked" })
  })

  it("masks every path in an array", () => {
    const event = {
      extra: {
        paths: ["C:\\Users\\jane\\Music\\a.flac", "C:\\Users\\jane\\Music\\b.flac"],
      },
    }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({
      paths: [`C:\\Users\\${MASK}\\Music\\a.flac`, `C:\\Users\\${MASK}\\Music\\b.flac`],
    })
  })
})
