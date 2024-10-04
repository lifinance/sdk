import { type Chain, type Client, type Transport, stringify } from 'viem'
import { getAction } from 'viem/utils'
import { observe } from '../utils/observe.js'
import { poll } from '../utils/poll.js'
import { type GetBlockCountReturnType, getBlockCount } from './getBlockCount.js'

export type OnBlockNumberParameter = GetBlockCountReturnType
export type OnBlockNumberFn = (
  blockNumber: OnBlockNumberParameter,
  prevBlockNumber: OnBlockNumberParameter | undefined
) => Promise<void>

export type WatchBlockNumberParameters = {
  /** The callback to call when a new block number is received. */
  onBlockNumber: OnBlockNumberFn
  /** The callback to call when an error occurred when trying to get for a new block. */
  onError?: ((error: Error) => void) | undefined
} & {
  /** Whether or not to emit the missed block numbers to the callback. */
  emitMissed?: boolean | undefined
  /** Whether or not to emit the latest block number to the callback when the subscription opens. */
  emitOnBegin?: boolean | undefined
  /** Polling frequency (in ms). Defaults to Client's pollingInterval config. */
  pollingInterval?: number | undefined
}

export type WatchBlockNumberReturnType = () => void

/**
 * Watches and returns incoming block numbers.
 * @param client - Client to use
 * @param parameters - {@link WatchBlockNumberParameters}
 * @returns A function that can be invoked to stop watching for new block numbers. {@link WatchBlockNumberReturnType}
 */
export function watchBlockNumber<
  chain extends Chain | undefined,
  transport extends Transport,
>(
  client: Client<transport, chain>,
  {
    emitOnBegin = false,
    emitMissed = false,
    onBlockNumber,
    onError,
    pollingInterval = client.pollingInterval,
  }: WatchBlockNumberParameters
): WatchBlockNumberReturnType {
  let prevBlockNumber: GetBlockCountReturnType | undefined

  const observerId = stringify([
    'watchBlockNumber',
    client.uid,
    emitOnBegin,
    emitMissed,
    pollingInterval,
  ])

  // TODO (edge cases):
  // 1) Stop iterating block numbers if we are happy with the result of one onBlockNumber execution but there is more in the queue.
  // 2) If we missed some time - user closed the page and came back when the block is already mined.
  // In this case we probably want to save the block when we send the transaction and track the currently checked blocks until we find the relevant one.
  return observe(observerId, { onBlockNumber, onError }, (emit) =>
    poll(
      async () => {
        try {
          const blockNumber = await getAction(
            client,
            getBlockCount,
            'getBlockCount'
          )({ cacheTime: 0 })

          if (prevBlockNumber) {
            // If the current block number is the same as the previous,
            // we can skip.
            if (blockNumber === prevBlockNumber) {
              return
            }

            // If we have missed out on some previous blocks, and the
            // `emitMissed` flag is truthy, let's emit those blocks.
            if (blockNumber - prevBlockNumber > 1 && emitMissed) {
              for (let i = prevBlockNumber + 1; i < blockNumber; i++) {
                await emit.onBlockNumber(i, prevBlockNumber)
                prevBlockNumber = i
              }
            }
          }

          // If the next block number is greater than the previous,
          // it is not in the past, and we can emit the new block number.
          if (!prevBlockNumber || blockNumber > prevBlockNumber) {
            await emit.onBlockNumber(blockNumber, prevBlockNumber)
            prevBlockNumber = blockNumber
          }
        } catch (err) {
          emit.onError?.(err as Error)
        }
      },
      {
        emitOnBegin,
        interval: pollingInterval,
      }
    )
  )
}
