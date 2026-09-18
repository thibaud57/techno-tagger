import { formatFileSize } from "./file-size"

describe("formatFileSize", () => {
  it("renders a track size in megabytes", () => {
    expect(formatFileSize(11_400_000, "en")).toBe("11.4 MB")
  })

  it("renders a truncated file in kilobytes", () => {
    expect(formatFileSize(5_000, "en")).toBe("5 kB")
  })

  // Espace fine insecable entre le nombre et l'unite : c'est `Intl` qui la pose en francais.
  it("follows the language of the interface", () => {
    expect(formatFileSize(11_400_000, "fr")).toBe("11,4 Mo")
  })

  it("keeps one decimal at most", () => {
    expect(formatFileSize(1_234_567, "en")).toBe("1.2 MB")
  })
})
