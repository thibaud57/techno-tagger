import type { DemoPaths, Scenario } from "../app/demo/scenario"

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
  },
  initial_outcomes: {},
  lines: [],
  stateless: [],
  stateful: [],
  ...overrides,
  paths: { vlc_dump: "LIB/dump.xspf", library: "LIB", destination: "DEST", ...overrides.paths },
})
