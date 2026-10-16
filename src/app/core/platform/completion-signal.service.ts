import { effect, inject, Service } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { SidecarService } from "../sidecar/sidecar.service"
import { readSoundSignal } from "./preferences"

/** Duree commune des toasts de l'application (DESIGN.md § Feedback et chargement). */
export const TOAST_LIFE = 4000

/** Deux notes courtes : une fin de phase s'entend sans couvrir ce qui se passe a l'ecran. */
const NOTES = [880, 1174.66] as const
const NOTE_SECONDS = 0.12
const PEAK_GAIN = 0.15

/** Cles ecrites en toutes lettres : une cle construite par concatenation echappe a la recherche. */
interface EndMessages {
  readonly done: string
  readonly withFailures: string
}
const WRITE_END: EndMessages = {
  done: "tagging.writeFinished",
  withFailures: "tagging.writeFinishedWithFailures",
}
const ROLLBACK_END: EndMessages = {
  done: "tagging.rollbackFinished",
  withFailures: "tagging.rollbackFinishedWithFailures",
}

/** Fin d'une phase longue : un bip synthetise (aucun fichier audio, ni binaire a relire ni licence a suivre), puis un toast. */
@Service()
export class CompletionSignalService {
  private readonly messages = inject(MessageService)
  private readonly translate = inject(TranslateService)
  private readonly sidecar = inject(SidecarService)

  /**
   * Branche sur un ecran, l'`effect()` mourrait avec lui. Un signal ne notifiant que sur une
   * nouvelle valeur, chaque fin s'annonce une fois.
   */
  constructor() {
    const ends = [
      [this.sidecar.extraction, "playlist.extractionFinished"],
      [this.sidecar.taggingFinished, "tagging.finished"],
    ] as const
    for (const [end, messageKey] of ends) {
      effect(() => {
        if (end() !== null) {
          void this.announce(messageKey)
        }
      })
    }
    effect(() => {
      const written = this.sidecar.writeFinished()
      if (written !== null) {
        void this.announceEnd(WRITE_END, written.write_error)
      }
    })
    effect(() => {
      const restored = this.sidecar.rollbackFinished()
      if (restored !== null) {
        void this.announceEnd(ROLLBACK_END, restored.failed.length)
      }
    })
  }

  async announce(
    messageKey: string,
    params: Record<string, unknown> = {},
    severity: "success" | "warn" = "success",
  ): Promise<void> {
    if (await readSoundSignal()) {
      this.beep()
    }
    this.messages.add({
      severity,
      summary: this.translate.instant(messageKey, params) as string,
      life: TOAST_LIFE,
    })
  }

  private announceEnd(keys: EndMessages, failures: number): Promise<void> {
    return failures === 0
      ? this.announce(keys.done)
      : this.announce(keys.withFailures, { count: failures }, "warn")
  }

  /** Un contexte refuse par la webview ne doit jamais empecher le toast. */
  private beep(): void {
    // Les types DOM donnent `AudioContext` toujours defini, la webview peut pourtant l'ignorer.
    if (typeof globalThis.AudioContext === "undefined") {
      return
    }
    let context: AudioContext
    try {
      context = new globalThis.AudioContext()
    } catch {
      return
    }

    // `onended` de la derniere note et le `catch` peuvent tous deux fermer : le second appel
    // leverait sur un contexte deja ferme.
    let closed = false
    const close = (): void => {
      if (closed) {
        return
      }
      closed = true
      void context.close()
    }

    try {
      NOTES.forEach((frequency, index) => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        oscillator.connect(gain)
        gain.connect(context.destination)
        const start = context.currentTime + index * NOTE_SECONDS
        gain.gain.setValueAtTime(PEAK_GAIN, start)
        gain.gain.linearRampToValueAtTime(0, start + NOTE_SECONDS)
        oscillator.start(start)
        oscillator.stop(start + NOTE_SECONDS)
        if (index === NOTES.length - 1) {
          // Fermer au tick de planification coupe le son : close() arrete le temps audio
          // alors que les notes sont planifiees plus loin.
          oscillator.onended = close
        }
      })
    } catch {
      close()
    }
  }
}
