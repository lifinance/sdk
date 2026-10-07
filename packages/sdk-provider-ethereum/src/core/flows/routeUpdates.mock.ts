/**
 * The route-update sequence that the EVM flow specs pin, shared by the
 * action-level (`harness.mock.ts`) and the network-level (`network.mock.ts`)
 * specs.
 *
 * Input: one entry per `updateRouteHook` fire, each the step's
 * `execution.actions` at that fire as `TYPE:STATUS` strings. Output: for every
 * fire, each action that is new or whose status differs from the previous
 * fire, in array order; then consecutive duplicates are removed. Actions are
 * matched by type (a step holds at most one action per type), so the
 * DONE-first re-sort of `StatusManager.updateAction` is not a change, and a
 * fire that changes no status (a new `txHash`, an execution field) adds
 * nothing.
 *
 * `lastSeen` is the fire before the first one, for a sequence that starts in
 * the middle of a run (one leg of a retried run): the first fire is compared
 * with it, not with an empty step. It defaults to an empty step.
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
export const dedupeActionPairs = (
  fires: readonly (readonly string[])[],
  lastSeen: readonly string[] = []
): string[] => {
  const sequence: string[] = []
  let previous = new Map(lastSeen.map(splitPair))
  for (const fire of fires) {
    const current = new Map<string, string>()
    for (const pair of fire) {
      const [type, status] = splitPair(pair)
      current.set(type, status)
      if (previous.get(type) !== status && sequence.at(-1) !== pair) {
        sequence.push(pair)
      }
    }
    previous = current
  }
  return sequence
}

/** `TYPE:STATUS` → `[TYPE, STATUS]`. */
const splitPair = (pair: string): [type: string, status: string] => {
  const separator = pair.lastIndexOf(':')
  return [pair.slice(0, separator), pair.slice(separator + 1)]
}
