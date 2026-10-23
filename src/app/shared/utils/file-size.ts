const BYTES_PER_KILOBYTE = 1000
const BYTES_PER_MEGABYTE = 1000 * BYTES_PER_KILOBYTE

/**
 * Taille lisible, unite d'`Intl`. Les Ko comptent autant que les Mo : un fichier tronque par une
 * copie interrompue pese quelques Ko, ce qu'un departage de doublon doit montrer.
 */
export const formatFileSize = (bytes: number, language: string): string => {
  const inMegabytes = bytes >= BYTES_PER_MEGABYTE

  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: inMegabytes ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / (inMegabytes ? BYTES_PER_MEGABYTE : BYTES_PER_KILOBYTE))
}
