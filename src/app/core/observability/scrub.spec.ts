import PATH_MASK_CASES from "../../../fixtures/path-masks.json"
import { MASK, PATH_MASK, scrub } from "./scrub"

/**
 * Le masquage est la seule barriere cote webview : `Breadcrumbs` et `Replay` sont
 * retirees, mais un message d'erreur formate autour d'un morceau porte son chemin, donc
 * le nom du fichier, l'artiste et le titre.
 */
describe("scrub", () => {
  const scrubbed = (event: object): Record<string, unknown> =>
    scrub(event as never, {}) as unknown as Record<string, unknown>

  // Corpus partage avec `test_observability.py` : le motif est recopie des deux cotes, seul ce
  // corpus commun fait echouer la derive de l'un sans l'autre.
  it.each(PATH_MASK_CASES)("masks like the sidecar: $case", ({ message, expected }) => {
    const event = { message }

    const result = scrubbed(event)

    expect(result["message"]).toBe(expected)
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
