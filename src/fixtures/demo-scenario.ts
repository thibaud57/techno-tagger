import { choose, type Choice, type ReplayState } from "../app/demo/replay"
import type {
  DemoPaths,
  JsonObject,
  Scenario,
  StatefulReply,
  StatelessReply,
} from "../app/demo/scenario"

type ScenarioOverrides = Partial<Omit<Scenario, "paths">> & {
  readonly paths?: Partial<DemoPaths>
}

/** Scenario minimal et valide : les specs ne surchargent que ce qu'elles exercent. */
export const scenarioWith = (overrides: ScenarioOverrides): Scenario => ({
  schema_version: 1,
  key_fields: {
    get_version: [],
    list_playlists: ["playlist_path"],
    extract_playlist: ["mode", "playlist_name"],
    start_tagging: ["folder"],
    list_runs: [],
    commit_run: ["run_id"],
    rollback: ["run_id", "track_id"],
    get_rollback_target: [],
    cancel_run: [],
    resolve_arbitration: ["track_id", "source", "candidate"],
    get_interrupted_run: [],
    resolve_by_url: ["track_id", "url"],
  },
  initial_outcomes: {},
  lines: [],
  stateless: [],
  stateful: [],
  ...overrides,
  paths: { vlc_dump: "LIB/dump.xspf", library: "LIB", destination: "DEST", ...overrides.paths },
})

/** Reponse sans etat au rang 1, sans issue ni phase : `rest` ne surcharge que ce que le cas exerce. */
export const statelessReply = (
  command: string,
  fields: JsonObject,
  lines: readonly number[],
  rest: Partial<StatelessReply> = {},
): StatelessReply => ({
  command: { command, ...fields },
  call: 1,
  sets: {},
  enters: null,
  lines,
  ...rest,
})

export const statefulReply = (
  command: string,
  fields: JsonObject,
  state: Pick<StatefulReply, "outcomes" | "phase">,
  lines: readonly number[],
  rest: Partial<StatefulReply> = {},
): StatefulReply => ({
  command: { command, ...fields },
  ...state,
  sets: {},
  enters: null,
  lines,
  ...rest,
})

/** `choose` pour un cas ou une reponse est attendue : l'absence d'enregistrement est un echec du test. */
export const chosen = (scenario: Scenario, state: ReplayState, command: JsonObject): Choice => {
  const choice = choose(scenario, state, command)
  if (choice === null) {
    throw new Error(`No reply for ${JSON.stringify(command)} in phase ${state.phase}`)
  }

  return choice
}
