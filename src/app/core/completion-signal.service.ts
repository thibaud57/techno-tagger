import { Injectable, effect, inject, type Signal } from "@angular/core"
import { TranslateService } from "@ngx-translate/core"
import { MessageService } from "primeng/api"

import { readSoundSignal } from "./preferences"

/** Deux notes courtes : une fin de phase s'entend sans couvrir ce qui se passe a l'ecran. */
const NOTES = [880, 1174.66] as const
const NOTE_SECONDS = 0.12
const PEAK_GAIN = 0.15

/**
 * Signal de fin d'une phase longue : un son, puis un toast. Partage par la fin de
 * la phase reseau d'un run et par la fin d'une extraction, qui n'en avait aucun.
 *
 * Aucun fichier audio dans le depot : pas de binaire a relire en diff, pas de
 * licence a suivre. Remplacer le bip par un fichier ne toucherait que ce service.
 */
@Injectable({ providedIn: "root" })
export class CompletionSignalService {
  private readonly messages = inject(MessageService)
  private readonly translate = inject(TranslateService)

  async announce(messageKey: string): Promise<void> {
    if (await readSoundSignal()) {
      this.beep()
    }
    this.messages.add({
      severity: "success",
      summary: this.translate.instant(messageKey) as string,
      life: 4000,
    })
  }

  /**
   * Garde partage par les ecrans qui annoncent la fin d'une phase longue : `source`
   * ne repasse a `null` qu'au lancement d'un nouveau run, jamais a la sortie de
   * l'onglet, et le composant qui le lit est detruit et recree a chaque navigation.
   * Partir de `null` reannoncerait donc une fin deja vue au premier rendu qui suit
   * un remontage. Partir de la valeur courante de `source` neutralise ce faux
   * positif sans manquer une vraie transition survenant pendant la vie du composant.
   *
   * Appelee depuis le constructeur d'un composant, `effect()` herite de son contexte
   * d'injection synchrone (`inject(Injector)` en interne lit l'injecteur ambiant du
   * point d'appel, pas celui de ce service) : l'effet est detruit avec le composant.
   */
  announceOnTransition<T>(source: Signal<T | null>, messageKey: string): void {
    let announced = source()
    effect(() => {
      const value = source()
      if (value !== null && value !== announced) {
        announced = value
        void this.announce(messageKey)
      }
    })
  }

  /** Un contexte refuse par la webview ne doit jamais empecher le toast. */
  private beep(): void {
    // Detection de fonctionnalite : les types DOM donnent `AudioContext` toujours defini,
    // la webview peut pourtant refuser le contexte a l'execution (edge case "Web Audio indisponible").
    if (typeof globalThis.AudioContext === "undefined") {
      return
    }
    let context: AudioContext
    try {
      context = new globalThis.AudioContext()
    } catch {
      return
    }

    // Une seule fermeture, d'ou que vienne la fin : `onended` de la derniere note en
    // marche nominale, le `catch` si la planification echoue a mi-chemin. Sans ce garde,
    // le second appel leverait sur un contexte deja ferme.
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
          // Fermer au tick de planification coupait le son avant qu'il ne joue :
          // close() arrete la progression du temps audio, alors que les notes sont
          // planifiees jusqu'a start + NOTE_SECONDS. On attend la derniere.
          oscillator.onended = close
        }
      })
    } catch {
      close()
    }
  }
}
