import type { SDKClient } from '@lifi/sdk'
import { getJitoRpcs, getSolanaRpcs } from './registry.js'

/**
 * Calls a function on RPC instances with retry logic.
 * Tries each RPC in sequence until one succeeds.
 *
 * @typeParam T - The type of the RPC instance.
 * @typeParam R - The return type of the function.
 * @param rpcs - An array of RPC instances to try.
 * @param fn - The async function to execute on each RPC until one succeeds.
 * @returns The result from the first successful RPC call.
 * @throws {Error} If no RPCs are available.
 * @throws {AggregateError} If all RPCs fail, containing all individual errors.
 *
 * @example
 * ```ts
 * const rpcs = await getSolanaRpcs(client)
 * const result = await callWithRetry(rpcs, (rpc) =>
 *   rpc.getBalance(address).send()
 * )
 * ```
 */
export async function callWithRetry<T, R>(
  rpcs: T[],
  fn: (rpc: T) => Promise<R>
): Promise<R> {
  if (rpcs.length === 0) {
    throw new Error('No RPCs available')
  }

  const errors: Error[] = []
  for (const rpc of rpcs) {
    try {
      return await fn(rpc)
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  throw new AggregateError(errors, `All ${rpcs.length} RPCs failed`)
}

/**
 * Creates a retry function for a specific RPC type.
 * @internal
 */
const createRetryFn =
  <T>(getRpcs: (client: SDKClient) => Promise<T[]>) =>
  async <R>(client: SDKClient, fn: (rpc: T) => Promise<R>): Promise<R> => {
    const rpcs = await getRpcs(client)
    return callWithRetry(rpcs, fn)
  }

/**
 * Calls a function on Solana RPC instances with retry logic.
 * Automatically fetches available Solana RPCs and tries each in sequence.
 *
 * @typeParam R - The return type of the function.
 * @param client - The SDK client used to fetch RPC URLs.
 * @param fn - The async function to execute on each RPC until one succeeds.
 * @returns The result from the first successful RPC call.
 * @throws {Error} If no Solana RPCs are available.
 * @throws {AggregateError} If all RPCs fail.
 *
 * @example
 * ```ts
 * const balance = await callSolanaRpcsWithRetry(client, (rpc) =>
 *   rpc.getBalance(address).send()
 * )
 * ```
 */
export const callSolanaRpcsWithRetry = createRetryFn(getSolanaRpcs)

/**
 * Calls a function on Jito RPC instances with retry logic.
 * Automatically fetches available Jito RPCs and tries each in sequence.
 *
 * @typeParam R - The return type of the function.
 * @param client - The SDK client used to fetch RPC URLs.
 * @param fn - The async function to execute on each RPC until one succeeds.
 * @returns The result from the first successful RPC call.
 * @throws {Error} If no Jito RPCs are available.
 * @throws {AggregateError} If all RPCs fail.
 *
 * @example
 * ```ts
 * const tipAccounts = await callJitoRpcsWithRetry(client, (rpc) =>
 *   rpc.getTipAccounts().send()
 * )
 * ```
 */
export const callJitoRpcsWithRetry = createRetryFn(getJitoRpcs)
