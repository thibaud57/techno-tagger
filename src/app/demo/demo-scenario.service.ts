import { Service } from "@angular/core"

import { DemoScenarioError, parseScenario, type Scenario } from "./scenario"

const SCENARIO_URL = "/demo/scenario.json"

@Service({ autoProvided: false })
export class DemoScenarioService {
  private loading: Promise<void> | null = null
  private loaded: Scenario | null = null

  /** Une seule requete reussie : un echec est oublie, pour que « Reessayer » relance le chargement. */
  load(): Promise<void> {
    this.loading ??= this.fetchScenario().catch((error: unknown) => {
      this.loading = null
      throw error
    })

    return this.loading
  }

  scenario(): Scenario {
    if (this.loaded === null) {
      throw new DemoScenarioError("scenario", "a scenario loaded before use")
    }

    return this.loaded
  }

  private async fetchScenario(): Promise<void> {
    const raw = await this.fetchRaw()

    this.loaded = parseScenario(raw)
  }

  /** Reseau coupe, reponse en erreur ou JSON illisible : le scenario est injoignable, cause jointe. */
  private async fetchRaw(): Promise<unknown> {
    try {
      const response = await fetch(SCENARIO_URL)
      if (!response.ok) {
        throw new DemoScenarioError(SCENARIO_URL, `a successful response, got ${response.status}`)
      }

      return await response.json()
    } catch (cause) {
      if (cause instanceof DemoScenarioError) {
        throw cause
      }
      throw new DemoScenarioError(SCENARIO_URL, "a reachable, readable JSON file", { cause })
    }
  }
}
