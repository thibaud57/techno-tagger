import { LANGUAGES, type Language } from "../core/i18n/language"

const LANGUAGE_PARAM = "lang"

/** Lit `?lang=` puis le retire de l'URL : un lien partage ne doit pas figer la langue d'une visite suivante. */
export const takeLanguageFromQuery = (
  location: Pick<Location, "search" | "pathname" | "hash">,
  history: Pick<History, "replaceState">,
): Language | null => {
  const query = new URLSearchParams(location.search)
  const requested = query.get(LANGUAGE_PARAM)
  if (requested === null) {
    return null
  }

  query.delete(LANGUAGE_PARAM)
  const rest = query.toString()
  history.replaceState(
    null,
    "",
    `${location.pathname}${rest === "" ? "" : `?${rest}`}${location.hash}`,
  )

  // `languageFromTag` replierait `de` sur l'anglais : une langue hors liste est ignoree.
  return LANGUAGES.find((known) => known === requested) ?? null
}
