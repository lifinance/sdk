import { sleep } from '../../../../utils/sleep.js'

type PollOptions<T> = {
  // Whether or not to emit when the polling starts.
  emitOnBegin?: boolean | undefined
  // The initial wait time (in ms) before polling.
  initialWaitTime?: ((data: T | undefined) => Promise<number>) | undefined
  // The interval (in ms).
  interval: number
}

/**
 * @description Polls a function at a specified interval.
 */
export function poll<T>(
  fn: ({ unpoll }: { unpoll: () => void }) => Promise<T | undefined>,
  { emitOnBegin, initialWaitTime, interval }: PollOptions<T>
) {
  let active = true

  const unwatch = () => {
    active = false
  }

  const watch = async () => {
    let data: T | undefined = undefined
    if (emitOnBegin) {
      data = await fn({ unpoll: unwatch })
    }

    const initialWait = (await initialWaitTime?.(data)) ?? interval
    await sleep(initialWait)

    const poll = async () => {
      if (!active) {
        return
      }
      await fn({ unpoll: unwatch })
      await sleep(interval)
      poll()
    }

    poll()
  }
  watch()

  return unwatch
}
