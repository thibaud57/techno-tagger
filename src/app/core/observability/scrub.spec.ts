import { MASK, PATH_MASK, QUERY_MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin, donc
 * le nom du fichier, l'artiste et le titre.
 */
describe("scrub", () => {
  const scrubbed = (event: object): Record<string, unknown> =>
    scrub(event as never, {}) as unknown as Record<string, unknown>

  it.each([
    ["a drive path with backslashes", String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`],
    ["a drive path with slashes", "D:/Musique/Nova Pulse - Your Mind.mp3"],
    ["a UNC path", String.raw`\\nas\partage\Nova Pulse - Your Mind.mp3`],
    ["a path under a home with a space", String.raw`C:\Users\Jean Dupont\Music\set.flac`],
    ["a path under a home with an apostrophe", String.raw`C:\Users\O'Brien\Music\set.flac`],
    ["a bare name with an apostrophe", String.raw`D:\Music\Nova Pulse - Don't Stop.mp3`],
  ])("masks %s whole", (_case, path) => {
    const event = { message: `cannot read ${path}: denied` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read ${PATH_MASK}: denied`)
  })

  it("masks a double-quoted path that contains an apostrophe", () => {
    const event = { message: String.raw`cannot read "D:\Music\Nova Pulse - Don't Stop.mp3"` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read "${PATH_MASK}"`)
  })

  it.each([
    ["before a letter", String.raw`D:\Music\Nova Pulse - Don't Stop.mp3`],
    ["before a space", String.raw`D:\Music\Nova Pulse - Guns N' Roses.mp3`],
  ])("masks a single-quoted path whose name has an apostrophe %s", (_case, path) => {
    const event = { message: `cannot read '${path}' failed` }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`cannot read '${PATH_MASK}' failed`)
  })

  it("swallows the text between two apostrophes that follows a single-quoted path", () => {
    const event = {
      message: String.raw`'D:\Music\Nova Pulse - Your Mind.mp3' from user's folder`,
    }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`'${PATH_MASK}'s folder`)
  })

  it("masks the query string of a URL but keeps its scheme, host and path", () => {
    const event = {
      message: "GET https://api.example/beatport/search?q=Beyer+Mind&next=http://cdn?w=1 failed",
    }

    const result = scrubbed(event)

    expect(result["message"]).toBe(`GET https://api.example/beatport/search?${QUERY_MASK} failed`)
  })

  it("does not take a URL scheme for a drive letter", () => {
    const event = { message: "see https://api.example/beatport/tracks/42" }

    const result = scrubbed(event)

    expect(result["message"]).toBe("see https://api.example/beatport/tracks/42")
  })

  it("masks the username of the POSIX home folders", () => {
    const event = {
      extra: {
        posix: "/home/jane/Music/set.flac",
        macos: "/Users/jane/Music/set.flac",
        tracks: 42,
      },
    }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({
      posix: `/home/${MASK}/Music/set.flac`,
      macos: `/Users/${MASK}/Music/set.flac`,
      tracks: 42,
    })
  })

  it("masks a mapping key as well as its value", () => {
    const event = { extra: { [String.raw`D:\Musique\Nova Pulse - Your Mind.mp3`]: "locked" } }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ [PATH_MASK]: "locked" })
  })

  it("masks every path in an array", () => {
    const event = {
      extra: { paths: [String.raw`D:\Musique\a.flac`, String.raw`D:\Musique\b.flac`] },
    }

    const result = scrubbed(event)

    expect(result["extra"]).toEqual({ paths: [PATH_MASK, PATH_MASK] })
  })
})
