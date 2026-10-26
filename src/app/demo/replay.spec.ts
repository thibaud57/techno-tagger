import { chosen, scenarioWith, statefulReply, statelessReply } from "../../fixtures/demo-scenario"
import { choose, commandKey, initialReplayState, recoveryUrlOf } from "./replay"
import type { JsonObject } from "./scenario"

// La table des cles vit dans la fixture, jamais dans src/app.
const KEY_FIELDS = scenarioWith({}).key_fields

const L0: JsonObject = { event: "a" }
const L1: JsonObject = { event: "b" }

const EXTRACT: JsonObject = { command: "extract_playlist", mode: "copy", playlist_name: null }

describe("commandKey", () => {
  it("keys a command on the fields the scenario names, whatever the optional fields", () => {
    const recorded = { command: "start_tagging", folder: "C:\\Users\\Demo\\Musique\\Extraction" }
    const sent = { ...recorded, thresholds: { floor: 70, ceiling: 90 } }

    expect(commandKey(sent, KEY_FIELDS)).toBe(commandKey(recorded, KEY_FIELDS))
    expect(commandKey({ ...EXTRACT, mode: "copy" }, KEY_FIELDS)).not.toBe(
      commandKey({ ...EXTRACT, mode: "move" }, KEY_FIELDS),
    )
  })

  it("treats a missing key field as null", () => {
    const keyed = commandKey({ command: "rollback", run_id: "de0002" }, KEY_FIELDS)

    expect(keyed).toBe(
      commandKey({ command: "rollback", run_id: "de0002", track_id: null }, KEY_FIELDS),
    )
  })
})

describe("choose", () => {
  it("answers the n-th identical command with the reply of its rank, then keeps the last one", () => {
    const scenario = scenarioWith({
      lines: [L0, L1],
      stateless: [
        statelessReply("extract_playlist", EXTRACT, [0]),
        statelessReply("extract_playlist", EXTRACT, [1], { call: 2 }),
      ],
    })

    const first = chosen(scenario, initialReplayState(scenario), EXTRACT)
    const second = chosen(scenario, first.next, EXTRACT)
    const third = chosen(scenario, second.next, EXTRACT)

    expect([first, second, third].map((choice) => choice.reply.lines)).toEqual([[0], [1], [1]])
  })

  it("prefers the stateful reply matching the current outcomes and phase", () => {
    const commit = { command: "commit_run", run_id: "de0002" }
    const scenario = scenarioWith({
      lines: [L0, L1],
      initial_outcomes: { "a.mp3": "pending" },
      stateless: [statelessReply("commit_run", { run_id: "de0002" }, [1])],
      stateful: [
        statefulReply(
          "commit_run",
          { run_id: "de0002" },
          { outcomes: { "a.mp3": "bandcamp" }, phase: "idle" },
          [1],
        ),
        statefulReply(
          "commit_run",
          { run_id: "de0002" },
          { outcomes: { "a.mp3": "pending" }, phase: "idle" },
          [0],
        ),
      ],
    })

    const choice = chosen(scenario, initialReplayState(scenario), commit)

    expect(choice.reply.lines).toEqual([0])
  })

  it("advances the rank only when a stateless reply serves", () => {
    const scenario = scenarioWith({
      lines: [L0],
      stateless: [statelessReply("extract_playlist", EXTRACT, [0])],
      stateful: [statefulReply("get_rollback_target", {}, { outcomes: {}, phase: "idle" }, [0])],
    })

    const extracted = chosen(scenario, initialReplayState(scenario), EXTRACT)
    const consulted = chosen(scenario, extracted.next, { command: "get_rollback_target" })

    expect(extracted.next.calls).toEqual({ [commandKey(EXTRACT, KEY_FIELDS)]: 1 })
    expect(consulted.next.calls).toEqual(extracted.next.calls)
  })

  it("applies the outcome and the phase a reply carries before its lines are sent", () => {
    const start = { command: "start_tagging", folder: "DEST" }
    const scenario = scenarioWith({
      lines: [L0],
      initial_outcomes: { "sub rosa.mp3": "pending" },
      stateless: [
        statelessReply("start_tagging", { folder: "DEST" }, [0], {
          sets: { "sub rosa.mp3": "first_beatport" },
          enters: "write_failed",
        }),
      ],
    })

    const choice = chosen(scenario, initialReplayState(scenario), start)

    expect(choice.next).toMatchObject({
      outcomes: { "sub rosa.mp3": "first_beatport" },
      phase: "write_failed",
    })
  })

  it("returns nothing for an unrecorded command", () => {
    const scenario = scenarioWith({
      lines: [L0],
      stateless: [statelessReply("extract_playlist", EXTRACT, [0])],
    })

    const choice = choose(scenario, initialReplayState(scenario), { command: "cancel_run" })

    expect(choice).toBeNull()
  })
})

describe("recoveryUrlOf", () => {
  const scenario = scenarioWith({
    stateful: [
      statefulReply(
        "resolve_by_url",
        { track_id: "lowlands.wav", url: "https://label.example/lowlands" },
        { outcomes: {}, phase: "not_written" },
        [],
      ),
    ],
  })

  it("reads the url recorded for the track", () => {
    expect(recoveryUrlOf(scenario, "lowlands.wav")).toBe("https://label.example/lowlands")
  })

  it("returns nothing for a track with no recorded url", () => {
    expect(recoveryUrlOf(scenario, "sub rosa.mp3")).toBeNull()
  })
})
