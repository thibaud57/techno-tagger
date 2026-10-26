import { Service, inject, signal } from "@angular/core"

import type { SidecarCommand } from "../core/sidecar/protocol"
import type { SidecarHandlers, SidecarTransport } from "../core/sidecar/sidecar-transport"
import { DemoScenarioService } from "./demo-scenario.service"
import { choose, commandKey, initialReplayState, type ReplayState } from "./replay"
import { DemoScenarioError, isJsonObject, type JsonValue, type Scenario } from "./scenario"

/** Ecart entre deux lignes d'une phase longue, pour que la progression se voie a l'ecran. */
const DEMO_LINE_DELAY_MS = 200

/** Commandes dont les lignes sont etalees : celles que le vrai sidecar met du temps a produire. */
const LONG_PHASE_COMMANDS = [
  "extract_playlist",
  "start_tagging",
  "commit_run",
  "retry_write",
  "rollback",
  "resolve_by_url",
] as const satisfies readonly SidecarCommand["command"][]

const isLongPhase = (name: JsonValue | undefined): boolean =>
  LONG_PHASE_COMMANDS.some((known) => known === name)

@Service({ autoProvided: false })
export class ReplayTransport implements SidecarTransport {
  private readonly scenarios = inject(DemoScenarioService)
  // `null` tant qu'aucune commande n'est passee : l'etat initial se tire du scenario charge.
  private readonly state = signal<ReplayState | null>(null)
  private handlers: SidecarHandlers | null = null

  async start(handlers: SidecarHandlers): Promise<boolean> {
    this.handlers = handlers

    try {
      await this.scenarios.load()

      return true
    } catch (error) {
      // Scenario injoignable ou invalide : DemoScenarioError. Toute autre erreur est un bug et remonte.
      if (error instanceof DemoScenarioError) {
        console.error("[demo] scenario illisible", error)

        return false
      }
      throw error
    }
  }

  send(line: string): Promise<void> {
    return Promise.resolve().then(() => {
      this.answer(line)
    })
  }

  private answer(line: string): void {
    const command: unknown = JSON.parse(line)
    if (!isJsonObject(command)) {
      throw new Error(`Not a command object: ${line}`)
    }

    const scenario = this.scenarios.scenario()
    const choice = choose(scenario, this.state() ?? initialReplayState(scenario), command)
    if (choice === null) {
      console.error("[demo] commande hors scenario", commandKey(command, scenario.key_fields))

      return
    }

    // Resolues avant de poser l'etat : un index invalide ne laisse pas le rejeu a moitie avance.
    const sent = choice.reply.lines.map((index) => this.lineAt(scenario, index))
    // Pose avant l'emission : une requete envoyee pendant l'emission voit deja la nouvelle phase.
    this.state.set(choice.next)

    const spacing = isLongPhase(command["command"]) ? DEMO_LINE_DELAY_MS : 0
    sent.forEach((payload, position) => {
      setTimeout(() => {
        this.handlers?.onLine(payload)
      }, position * spacing)
    })
  }

  private lineAt(scenario: Scenario, index: number): string {
    const recorded = scenario.lines[index]
    if (recorded === undefined) {
      throw new DemoScenarioError(`lines[${index}]`, "a recorded line")
    }

    return JSON.stringify(
      recorded["event"] === "version" ? { ...recorded, version: APP_VERSION } : recorded,
    )
  }
}
