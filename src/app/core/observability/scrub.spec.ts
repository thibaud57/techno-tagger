import { MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin.
 */
describe("scrub", () => {
  const scrubbed = (event: object): Record<string, unknown> =>
    scrub(event as never, {}) as unknown as Record<string, unknown>

  it.each([
    ["Windows", "C:\\Users\\jane\\Music\\set.flac", `C:\\Users\\${MASK}\\Music\\set.flac`],
    ["Windows with slashes", "C:/Users/jane/Music/set.flac", `C:/Users/${MASK}/Music/set.flac`],
    ["Linux", "/home/jane/Music/set.flac", `/home/${MASK}/Music/set.flac`],
    ["macOS", "/Users/jane/Music/set.flac", `/Users/${MASK}/Music/set.flac`],
  ])("masks the username in a %s path, at any depth", (_form, path, expected) => {
    const event = { message: `cannot read ${path}`, extra: { nested: { path } } }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read ${expected}`)
    expect(result["extra"]).toEqual({ nested: { path: expected } })
  })

  it("leaves a value that is not a string alone", () => {
    const event = { extra: { tracks: 42, retried: false } }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ tracks: 42, retried: false })
  })

  it.each([
    ["a space", "Jane Doe"],
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
