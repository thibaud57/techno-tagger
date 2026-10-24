/** Objet JSON quelconque, à réduire champ par champ. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
