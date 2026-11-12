import type {
  Chain,
  Client,
  Hash,
  SendCallsParameters,
  SendCallsReturnType,
  SendTransactionParameters,
} from 'viem'
import { sendCalls, sendTransaction } from 'viem/actions'
import { getAction } from 'viem/utils'

// A matching `client.chain` keeps its fees, serializers and custom fields; a
// stale or missing one gives way to the given chain.
export const getSendChain = (client: Client, chain: Chain): Chain =>
  client.chain?.id === chain.id ? client.chain : chain

/** Every SDK `sendTransaction` goes through here, so it gets the chain rule. */
export const sendTransactionOnChain = (
  client: Client,
  chain: Chain | undefined,
  parameters: SendTransactionParameters
): Promise<Hash> =>
  getAction(
    client,
    sendTransaction,
    'sendTransaction'
  )({
    ...parameters,
    ...(chain && { chain: getSendChain(client, chain) }),
  } as SendTransactionParameters)

/** Every SDK `sendCalls` goes through here, so it gets the chain rule. */
export const sendCallsOnChain = (
  client: Client,
  chain: Chain,
  parameters: SendCallsParameters
): Promise<SendCallsReturnType> =>
  getAction(
    client,
    sendCalls,
    'sendCalls'
  )({
    ...parameters,
    chain: getSendChain(client, chain),
  } as SendCallsParameters)
