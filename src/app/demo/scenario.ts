import { isRecord } from "../core/record"

/** Miroir TypeScript du modele `demo_scenario.py`, garde par `test_demo_scenario_mirror.py`. */

export const OUTCOMES = [
  "pending",
  "first_beatport",
  "second_beatport",
  "bandcamp",
  "refused",
  "recovered_by_url",
  "unresolved",
] as const

export type Outcome = (typeof OUTCOMES)[number]

export const PHASES = [
  "idle",
  "not_written",
  "write_failed",
  "written",
  "rolled_back_after_retry",
  "rolled_back_without_retry",
] as const

export type Phase = (typeof PHASES)[number]

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export interface DemoPaths {
  readonly vlc_dump: string
  readonly library: string
  readonly destination: string
}

export interface ReplyBase {
  readonly command: JsonObject
  readonly sets: Readonly<Record<string, Outcome>>
  readonly enters: Phase | null
  readonly lines: readonly number[]
}

export interface StatelessReply extends ReplyBase {
  readonly call: number
}

export interface StatefulReply extends ReplyBase {
  readonly outcomes: Readonly<Record<string, Outcome>>
  readonly phase: Phase
}

export interface Scenario {
  readonly schema_version: 1
  readonly paths: DemoPaths
  readonly key_fields: Readonly<Record<string, readonly string[]>>
  readonly initial_outcomes: Readonly<Record<string, Outcome>>
  readonly lines: readonly JsonObject[]
  readonly stateless: readonly StatelessReply[]
  readonly stateful: readonly StatefulReply[]
}

export class DemoScenarioError extends Error {
  constructor(field: string, expected: string, options?: ErrorOptions) {
    super(`Invalid demo scenario, ${field}: expected ${expected}`, options)
    this.name = "DemoScenarioError"
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>

const isPlainObject = (value: unknown): value is UnknownRecord =>
  isRecord(value) && !Array.isArray(value)

const isJsonValue = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every(isJsonValue)) ||
  (isPlainObject(value) && Object.values(value).every(isJsonValue))

const isOutcome = (value: unknown): value is Outcome => OUTCOMES.some((known) => known === value)

const isPhase = (value: unknown): value is Phase => PHASES.some((known) => known === value)

const recordAt = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainObject(value)) {
    throw new DemoScenarioError(path, "an object")
  }

  return value
}

const fieldOf = (parent: unknown, key: string, path: string): unknown => recordAt(parent, path)[key]

const arrayAt = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new DemoScenarioError(path, "an array")
  }

  return value
}

const stringAt = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new DemoScenarioError(path, "a string")
  }

  return value
}

export const isJsonObject = (value: unknown): value is JsonObject =>
  isPlainObject(value) && isJsonValue(value)

const jsonObjectAt = (value: unknown, path: string): JsonObject => {
  if (!isJsonObject(value)) {
    throw new DemoScenarioError(path, "a JSON object")
  }

  return value
}

const outcomeAt = (value: unknown, path: string): Outcome => {
  if (!isOutcome(value)) {
    throw new DemoScenarioError(path, `one of ${OUTCOMES.join(", ")}`)
  }

  return value
}

const phaseAt = (value: unknown, path: string): Phase => {
  if (!isPhase(value)) {
    throw new DemoScenarioError(path, `one of ${PHASES.join(", ")}`)
  }

  return value
}

const outcomesAt = (value: unknown, path: string): Readonly<Record<string, Outcome>> =>
  Object.fromEntries(
    Object.entries(recordAt(value, path)).map(([key, outcome]) => [
      key,
      outcomeAt(outcome, `${path}.${key}`),
    ]),
  )

const parsePaths = (value: unknown): DemoPaths => ({
  vlc_dump: stringAt(fieldOf(value, "vlc_dump", "paths"), "paths.vlc_dump"),
  library: stringAt(fieldOf(value, "library", "paths"), "paths.library"),
  destination: stringAt(fieldOf(value, "destination", "paths"), "paths.destination"),
})

const parseKeyFields = (value: unknown): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(recordAt(value, "key_fields")).map(([command, names]) => [
      command,
      arrayAt(names, `key_fields.${command}`).map((name, index) =>
        stringAt(name, `key_fields.${command}[${index}]`),
      ),
    ]),
  )

const lineIndexesAt = (value: unknown, path: string, lineCount: number): readonly number[] =>
  arrayAt(value, path).map((index, position) => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= lineCount) {
      throw new DemoScenarioError(`${path}[${position}]`, `an index below ${lineCount}`)
    }

    return index
  })

const parseReplyBase = (value: unknown, path: string, lineCount: number): ReplyBase => {
  const enters = fieldOf(value, "enters", path)

  return {
    command: jsonObjectAt(fieldOf(value, "command", path), `${path}.command`),
    sets: outcomesAt(fieldOf(value, "sets", path), `${path}.sets`),
    enters: enters === null ? null : phaseAt(enters, `${path}.enters`),
    lines: lineIndexesAt(fieldOf(value, "lines", path), `${path}.lines`, lineCount),
  }
}

const parseStateless = (value: unknown, index: number, lineCount: number): StatelessReply => {
  const path = `stateless[${index}]`
  const call = fieldOf(value, "call", path)

  if (typeof call !== "number" || !Number.isInteger(call) || call < 1) {
    throw new DemoScenarioError(`${path}.call`, "an integer of 1 or more")
  }

  return { ...parseReplyBase(value, path, lineCount), call }
}

const parseStateful = (value: unknown, index: number, lineCount: number): StatefulReply => {
  const path = `stateful[${index}]`

  return {
    ...parseReplyBase(value, path, lineCount),
    outcomes: outcomesAt(fieldOf(value, "outcomes", path), `${path}.outcomes`),
    phase: phaseAt(fieldOf(value, "phase", path), `${path}.phase`),
  }
}

/** Frontiere du scenario : tout ce qui en sort est typé, le rejeu ne revalide rien. */
export const parseScenario = (raw: unknown): Scenario => {
  if (fieldOf(raw, "schema_version", "scenario") !== 1) {
    throw new DemoScenarioError("schema_version", "1")
  }

  const lines = arrayAt(fieldOf(raw, "lines", "scenario"), "lines").map((line, index) =>
    jsonObjectAt(line, `lines[${index}]`),
  )

  return {
    schema_version: 1,
    paths: parsePaths(fieldOf(raw, "paths", "scenario")),
    key_fields: parseKeyFields(fieldOf(raw, "key_fields", "scenario")),
    initial_outcomes: outcomesAt(fieldOf(raw, "initial_outcomes", "scenario"), "initial_outcomes"),
    lines,
    stateless: arrayAt(fieldOf(raw, "stateless", "scenario"), "stateless").map((reply, index) =>
      parseStateless(reply, index, lines.length),
    ),
    stateful: arrayAt(fieldOf(raw, "stateful", "scenario"), "stateful").map((reply, index) =>
      parseStateful(reply, index, lines.length),
    ),
  }
}
