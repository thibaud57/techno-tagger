import { open } from "@tauri-apps/plugin-dialog"

/** Hors Tauri, le plugin `dialog` rejette : l'ecran reste utilisable. */
export const pickPath = async (options: { directory: boolean }): Promise<string | null> => {
  try {
    const chosen = await open({ directory: options.directory, multiple: false })

    return typeof chosen === "string" ? chosen : null
  } catch {
    return null
  }
}
