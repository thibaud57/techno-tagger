/** `Intl` et non `DatePipe` : aucune locale FR n'est enregistree. */
export const runDate = (iso: string, language: string | null): string => {
  const date = new Date(iso)
  // `format` leve une RangeError sur une date invalide et un computed la relancerait a chaque lecture.
  if (Number.isNaN(date.getTime())) {
    return iso
  }

  return new Intl.DateTimeFormat(language ?? undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

/** Parametres de `settings.admin.rollback.target` : la date d'ecriture d'un run et son dossier. */
export const runLine = (
  writtenAt: string,
  folder: string,
  language: string | null,
): { date: string; folder: string } => ({ date: runDate(writtenAt, language), folder })
