import { ChainId, LruMap, type SDKClient } from '@lifi/sdk'
import { TronWeb } from 'tronweb'

/** @internal Exposed so unit tests can clear between cases (e.g. `tronWebCache.clear()`). */
export const tronWebCache: LruMap<TronWeb> = new LruMap<TronWeb>(12)

export async function callTronRpcsWithRetry<R>(
  client: SDKClient,
  fn: (tronWeb: TronWeb) => Promise<R>
): Promise<R> {
  const urls = await client.getRpcUrlsByChainId(ChainId.TRN)

  if (!urls.length) {
    throw new Error('No Tron RPC URLs available')
  }

  const errors: Error[] = []
  for (const url of urls) {
    try {
      let tronWeb = tronWebCache.get(url)
      if (!tronWeb) {
        tronWeb = new TronWeb({ fullHost: url })
        tronWebCache.set(url, tronWeb)
      }
      return await fn(tronWeb)
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  throw new AggregateError(errors, `All ${urls.length} Tron RPCs failed`)
}
