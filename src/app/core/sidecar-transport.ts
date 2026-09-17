import { InjectionToken } from "@angular/core"
import { Child, Command } from "@tauri-apps/plugin-shell"

/** Nom d'`externalBin` et de la capability : un nom errone donne un `SidecarNotAllowed`. */
export const SIDECAR_BINARY = "tagger"
/** Tauri strippe le target triple au staging : c'est ce nom que l'ecran bloquant montre. */
export const SIDECAR_FILE = `${SIDECAR_BINARY}.exe`

/**
 * Frontiere vers Tauri, seul endroit qui connait `Command.sidecar`.
 *
 * Son existence sert le test : la rule de test du projet demande de mocker le
 * protocole au niveau du service qui l'expose, pas les plugins Tauri sous-jacents.
 * Un transport de test pousse des lignes a la demande, sans binaire ni webview.
 */
export interface SidecarHandlers {
  /** Une ligne de `stdout`, deja decoupee par Tauri : un evenement NDJSON complet. */
  readonly onLine: (line: string) => void
  /** Une ligne de `stderr` : un log, jamais un evenement du protocole. */
  readonly onStderr: (line: string) => void
  readonly onTerminated: () => void
}

export interface SidecarTransport {
  /** Rend `false` quand le sidecar n'a pas pu demarrer, sans lever. */
  start(handlers: SidecarHandlers): Promise<boolean>
  send(line: string): Promise<void>
}

class TauriSidecarTransport implements SidecarTransport {
  private child: Child | null = null

  async start(handlers: SidecarHandlers): Promise<boolean> {
    try {
      // Nom exact d'`externalBin`, sans suffixe target triple : c'est ce que
      // resout `Command.sidecar` cote JS, et un nom errone donne un
      // `SidecarNotAllowed` au premier lancement.
      const command = Command.sidecar(`binaries/${SIDECAR_BINARY}`)

      command.stdout.on("data", handlers.onLine)
      command.stderr.on("data", handlers.onStderr)

      // Seul `close` est une sortie du process : il porte le code de sortie. `error`
      // signale un incident du flux, le process peut tourner toujours, et le prendre
      // pour une mort affiche l'ecran bloquant sur un moteur bien vivant.
      command.on("close", () => {
        this.child = null
        handlers.onTerminated()
      })
      command.on("error", (error) => {
        console.error("[sidecar] erreur du flux", error)
      })

      // `spawn` et jamais `execute` : le protocole est un flux continu sur un
      // process long, `execute` attendrait sa fin.
      this.child = await command.spawn()

      return true
    } catch (error) {
      // Hors Tauri, `invoke` rejette faute de `window.__TAURI_INTERNALS__`. Sous Tauri, un
      // binaire absent ou mis en quarantaine echoue ici : trace, sinon rien ne le montre.
      console.error("[sidecar] lancement impossible", error)
      this.child = null

      return false
    }
  }

  async send(line: string): Promise<void> {
    // Rejeter plutot qu'ecrire dans le vide : l'appelant traite l'echec comme une panne.
    if (this.child === null) {
      throw new Error("sidecar not running")
    }
    await this.child.write(line)
  }
}

export const SIDECAR_TRANSPORT = new InjectionToken<SidecarTransport>("SidecarTransport", {
  providedIn: "root",
  factory: () => new TauriSidecarTransport(),
})
