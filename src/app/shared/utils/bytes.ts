/** Base decimale, comme `CACHE_MAX_BYTES` du sidecar : son plafond s'y lit en Mo ronds. */
const SCALES = [
  { unit: "gigabyte", size: 1_000_000_000 },
  { unit: "megabyte", size: 1_000_000 },
  { unit: "kilobyte", size: 1_000 },
] as const

/** Des 999,5 ko, l'unite du dessous s'arrondirait a 1 000 : 1 Mo plutot que 1 000 ko. */
const ROUNDS_UP = 0.9995

/**
 * Taille lisible dans la langue de l'interface : 418 Mo, 418 MB.
 * A part de `formatFileSize` : ici l'echelle va de l'octet au Go et la decimale tombe des 10.
 */
export const formatBytes = (bytes: number, language: string): string => {
  const scale = SCALES.find(({ size }) => bytes >= size * ROUNDS_UP)
  const value = scale ? bytes / scale.size : bytes

  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: scale?.unit ?? "byte",
    unitDisplay: "short",
    // Une decimale sous 10 : 1,5 Mo dit plus que 2 Mo.
    maximumFractionDigits: scale && value < 10 ? 1 : 0,
  }).format(value)
}
