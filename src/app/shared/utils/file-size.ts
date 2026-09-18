const BYTES_PER_KILOBYTE = 1000
const BYTES_PER_MEGABYTE = 1000 * BYTES_PER_KILOBYTE

/**
 * Taille de fichier lisible, dans l'unite de la locale.
 *
 * Les Ko comptent autant que les Mo : un fichier tronque par une copie interrompue
 * pese quelques Ko, et c'est precisement ce qu'un departage de doublon doit montrer.
 * L'unite vient d'`Intl`, jamais d'un libelle ecrit a la main.
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
