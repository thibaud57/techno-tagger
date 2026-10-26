import rawScenario from "../../demo/scenario.json"
import { chosen } from "../../fixtures/demo-scenario"
import { choose, initialReplayState, type Choice, type ReplayState } from "./replay"
import { parseScenario, type JsonObject, type StatefulReply } from "./scenario"

const scenario = parseScenario(rawScenario)

const COMBINATIONS: readonly (readonly [string, StatefulReply])[] = scenario.stateful
  .filter((reply) => reply.command["command"] === "commit_run")
  .map((commit) => [
    Object.entries(commit.outcomes)
      .map(([trackId, outcome]) => `${trackId}=${outcome}`)
      .join(", "),
    commit,
  ])

const GESTURES = ["resolve_arbitration", "switch_arbitration_source", "resolve_by_url"]

const recorded = (name: string, call?: number): JsonObject => {
  const candidates =
    call === undefined
      ? [...scenario.stateless, ...scenario.stateful]
      : scenario.stateless.filter((reply) => reply.call === call)
  const reply = candidates.find((candidate) => candidate.command["command"] === name)
  if (reply === undefined) {
    throw new Error(`No reply recorded for ${name}`)
  }

  return reply.command
}

// Le rang 2 d'une extraction porte la meme cle que le rang 1 : l'envoyer deux fois rejoue les deux rangs.
const EXTRACTION = recorded("extract_playlist", 2)

const play = (state: ReplayState, commands: readonly JsonObject[]): ReplayState =>
  commands.reduce((current, command) => chosen(scenario, current, command).next, state)

const gestureCommands = scenario.stateful
  .map((reply) => reply.command)
  .filter((command) => GESTURES.some((name) => name === command["command"]))

const isChoice = (choice: Choice | null): choice is Choice => choice !== null

const SETTINGS = ["list_runs", "get_rollback_target", "get_cache_size"].map((name) =>
  recorded(name),
)

// Le geste que la demo a enregistre dans l'etat courant et qui donne a un morceau l'issue visee.
const gestureTowards = (state: ReplayState, target: StatefulReply["outcomes"]): Choice | null => {
  const choices = gestureCommands
    .map((command) => choose(scenario, state, command))
    .filter(isChoice)

  return (
    Object.entries(target)
      .filter(([trackId, outcome]) => state.outcomes[trackId] !== outcome)
      .map(([trackId, outcome]) => choices.find((choice) => choice.reply.sets[trackId] === outcome))
      .find((choice) => choice !== undefined) ?? null
  )
}

const decide = (state: ReplayState, target: StatefulReply["outcomes"]): ReplayState => {
  const gesture = gestureTowards(state, target)

  return gesture === null ? state : decide(play(gesture.next, SETTINGS), target)
}

const OPENED = play(initialReplayState(scenario), [
  ...[
    "get_version",
    "get_interrupted_run",
    "list_runs",
    "get_rollback_target",
    "get_cache_size",
  ].map((name) => recorded(name)),
  EXTRACTION,
  EXTRACTION,
  recorded("start_tagging"),
  ...SETTINGS,
])

describe("the recorded scenario", () => {
  it("holds the 32 combinations the recording reports", () => {
    expect(COMBINATIONS).toHaveLength(32)
  })

  it.each(COMBINATIONS)(
    "replays every recorded combination from the initial state to its rollback (%s)",
    (_, commit) => {
      const decided = decide(OPENED, commit.outcomes)
      const committed = chosen(scenario, decided, commit.command)
      const withRetry = play(committed.next, [recorded("retry_write"), recorded("rollback")])
      const withoutRetry = play(committed.next, [recorded("rollback")])

      expect(decided.outcomes).toEqual(commit.outcomes)
      expect(committed.reply).toBe(commit)
      expect(withRetry.phase).toBe("rolled_back_after_retry")
      expect(withoutRetry.phase).toBe("rolled_back_without_retry")
    },
  )
})
