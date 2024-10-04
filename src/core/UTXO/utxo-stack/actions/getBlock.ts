import { Block } from 'bitcoinjs-lib'
import {
  type Account,
  BlockNotFoundError,
  type Chain,
  type Client,
  type Transport,
} from 'viem'
import type { UTXOSchema } from '../transports/utxo/types.js'

export type GetBlockParameters =
  | {
      blockHash: string
      blockNumber?: never
    }
  | {
      blockHash?: never
      blockNumber: number
    }

export type GetBlockReturnType = Block

export async function getBlock<
  C extends Chain | undefined,
  A extends Account | undefined = Account | undefined,
>(
  client: Client<Transport, C, A, UTXOSchema>,
  { blockHash, blockNumber }: GetBlockParameters
): Promise<GetBlockReturnType> {
  let blockHex: string | undefined
  try {
    let _blockHash = blockHash
    if (!_blockHash && blockNumber) {
      _blockHash = await client.request(
        {
          method: 'getblockhash',
          params: [blockNumber],
        },
        { dedupe: true }
      )
    }
    if (_blockHash) {
      blockHex = await client.request(
        {
          method: 'getblock',
          params: [_blockHash, 0],
        },
        { dedupe: true }
      )
    }
  } catch (_error) {
    throw new BlockNotFoundError({ blockHash, blockNumber } as never)
  }
  if (!blockHex) {
    throw new BlockNotFoundError({ blockHash, blockNumber } as never)
  }
  return Block.fromHex(blockHex)
}
