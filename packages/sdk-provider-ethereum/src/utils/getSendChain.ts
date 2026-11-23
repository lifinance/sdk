import type { Chain, Client } from 'viem'

// A matching `client.chain` keeps its fees, serializers and custom fields; a
// stale or missing one gives way to the given chain.
export const getSendChain = (client: Client, chain: Chain): Chain =>
  client.chain?.id === chain.id ? client.chain : chain
