/**
 * The route-update sequence of the money-path spec (§4.2.2), shared by the
 * action-level (`harness.mock.ts`) and the network-level (`network.mock.ts`)
 * EVM flow specs.
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
 * `.mock.ts` keeps this file out of `dist`.
 */
export const dedupeActionPairs = (
  fires: readonly (readonly string[])[]
): string[] => {
  const sequence: string[] = []
  let previous = new Map<string, string>()
  for (const fire of fires) {
    const current = new Map<string, string>()
    for (const pair of fire) {
      const separator = pair.lastIndexOf(':')
      const type = pair.slice(0, separator)
      const status = pair.slice(separator + 1)
      current.set(type, status)
      if (previous.get(type) !== status && sequence.at(-1) !== pair) {
        sequence.push(pair)
      }
    }
    previous = current
  }
  return sequence
}
