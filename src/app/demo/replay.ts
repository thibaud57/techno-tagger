import {
  isPlainObject,
  type JsonObject,
  type Outcome,
  type Phase,
  type Scenario,
  type StatefulReply,
  type StatelessReply,
} from "./scenario"

/** Nom de la commande et ses champs identifiants serialises, la seule forme sous laquelle on compare. */
export type CommandKey = string & { readonly __brand: "CommandKey" }

export interface ReplayState {
  readonly outcomes: Readonly<Record<string, Outcome>>
  readonly phase: Phase
  readonly calls: Readonly<Record<CommandKey, number>>
}

export interface Choice {
  readonly reply: StatelessReply | StatefulReply
  readonly next: ReplayState
}

export const initialReplayState = (scenario: Scenario): ReplayState => ({
  outcomes: scenario.initial_outcomes,
  phase: "idle",
  calls: {},
})

// Cles triees a tous les niveaux, comme `sort_keys` cote Python : l'ordre d'ecriture ne change pas la cle.
const sortKeys = (_key: string, value: unknown): unknown =>
  isPlainObject(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
    : value

/**
 * Memes champs et cles triees que `command_key` (`sidecar/tests/helpers/demo_scenario.py`), un champ absent
 * vaut `null` ; la serialisation n'est comparee que de TS a TS, jamais a la cle Python.
 */
export const commandKey = (command: JsonObject, keyFields: Scenario["key_fields"]): CommandKey => {
  const name = command["command"]
  const fields = typeof name === "string" ? keyFields[name] : undefined
  if (fields === undefined) {
    throw new Error(
      `No key fields for the command ${JSON.stringify(name)}: the scenario does not know it`,
    )
  }

  return JSON.stringify(
    {
      command: name,
      ...Object.fromEntries(fields.map((field) => [field, command[field] ?? null])),
    },
    sortKeys,
  ) as CommandKey
}

const sameOutcomes = (
  recorded: Readonly<Record<string, Outcome>>,
  current: Readonly<Record<string, Outcome>>,
): boolean =>
  Object.keys(recorded).length === Object.keys(current).length &&
  Object.entries(recorded).every(([trackId, outcome]) => current[trackId] === outcome)

// Les issues et la phase s'appliquent des le choix, avant l'emission des lignes : les requetes que
// l'interface envoie pendant cette emission voient deja le nouvel etat.
const enter = (state: ReplayState, reply: StatelessReply | StatefulReply): ReplayState => ({
  outcomes: { ...state.outcomes, ...reply.sets },
  phase: reply.enters ?? state.phase,
  calls: state.calls,
})

const latestUpTo = (replies: readonly StatelessReply[], rank: number): StatelessReply | null =>
  replies
    .filter((reply) => reply.call <= rank)
    .reduce<StatelessReply | null>(
      (latest, reply) => (latest === null || reply.call > latest.call ? reply : latest),
      null,
    )

/** Reponse avec etat si elle colle aux issues et a la phase, sinon sans etat au rang de la cle, `null` si rien n'est enregistre. */
export const choose = (
  scenario: Scenario,
  state: ReplayState,
  command: JsonObject,
): Choice | null => {
  const key = commandKey(command, scenario.key_fields)
  const recordedFor = (reply: StatelessReply | StatefulReply): boolean =>
    commandKey(reply.command, scenario.key_fields) === key

  const stateful = scenario.stateful.find(
    (reply) =>
      reply.phase === state.phase &&
      sameOutcomes(reply.outcomes, state.outcomes) &&
      recordedFor(reply),
  )
  if (stateful !== undefined) {
    return { reply: stateful, next: enter(state, stateful) }
  }

  // Au-dela du dernier rang enregistre, le dernier sert.
  const rank = (state.calls[key] ?? 0) + 1
  const stateless = latestUpTo(scenario.stateless.filter(recordedFor), rank)

  return stateless === null
    ? null
    : {
        reply: stateless,
        next: { ...enter(state, stateless), calls: { ...state.calls, [key]: rank } },
      }
}

/** `url` enregistree pour le rattrapage d'un morceau, source de l'indice affiche dans le champ. */
export const recoveryUrlOf = (scenario: Scenario, trackId: string): string | null => {
  const url = scenario.stateful.find(
    ({ command }) => command["command"] === "resolve_by_url" && command["track_id"] === trackId,
  )?.command["url"]

  return typeof url === "string" ? url : null
}
