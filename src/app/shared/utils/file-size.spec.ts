import { formatFileSize } from "./file-size"

describe("formatFileSize", () => {
  it.each([
    {
      case: "renders a track size in megabytes",
      bytes: 11_400_000,
      language: "en",
      size: "11.4 MB",
    },
    { case: "renders a truncated file in kilobytes", bytes: 5_000, language: "en", size: "5 kB" },
    // Espace fine insecable entre le nombre et l'unite : c'est `Intl` qui la pose en francais.
    {
      case: "follows the language of the interface",
      bytes: 11_400_000,
      language: "fr",
      size: "11,4 Mo",
    },
    { case: "keeps one decimal at most", bytes: 1_234_567, language: "en", size: "1.2 MB" },
  ])("$case", ({ bytes, language, size }) => {
    expect(formatFileSize(bytes, language)).toBe(size)
  })
})
