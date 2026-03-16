import { ChainId, type SDKClient } from '@lifi/sdk'
import { TronWeb } from 'tronweb'

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
      return await fn(new TronWeb({ fullHost: url }))
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  throw new AggregateError(errors, `All ${urls.length} Tron RPCs failed`)
}
