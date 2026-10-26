import { Service, inject } from "@angular/core"

import { isRecord } from "../core/record"
import type { SidecarHandlers, SidecarTransport } from "../core/sidecar/sidecar-transport"
import { DemoScenarioService } from "./demo-scenario.service"
import { DemoScenarioError, type StatelessReply } from "./scenario"

/** Les seules commandes auxquelles le shell repond tout seul, avant tout rejeu. */
export const STARTUP_COMMANDS = ["get_version", "get_interrupted_run"] as const

const isStartupCommand = (name: string): boolean => STARTUP_COMMANDS.some((known) => known === name)

@Service({ autoProvided: false })
export class ReplayTransport implements SidecarTransport {
  private readonly scenarios = inject(DemoScenarioService)
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
    const parsed: unknown = JSON.parse(line)
    const name = isRecord(parsed) ? parsed["command"] : undefined
    if (typeof name !== "string" || !isStartupCommand(name)) {
      return
    }

    const reply = this.scenarios
      .scenario()
      .stateless.find((candidate) => candidate.call === 1 && candidate.command["command"] === name)
    if (reply !== undefined) {
      this.emit(reply)
    }
  }

  private emit(reply: StatelessReply): void {
    const { lines } = this.scenarios.scenario()

    for (const index of reply.lines) {
      const recorded = lines[index]
      if (recorded === undefined) {
        throw new DemoScenarioError(`lines[${index}]`, "a recorded line")
      }
      const sent =
        recorded["event"] === "version" ? { ...recorded, version: APP_VERSION } : recorded

      this.handlers?.onLine(JSON.stringify(sent))
    }
  }
}
