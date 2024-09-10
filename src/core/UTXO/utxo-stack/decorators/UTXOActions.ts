import type { Account, Chain, Client, Transport } from 'viem'
import {
  getBlockCount,
  type GetBlockCountReturnType,
} from '../actions/getBlockCount.js'
import {
  getUTXOTransaction,
  type GetUTXOTransactionParameters,
  type GetUTXOTransactionReturnType,
} from '../actions/getUTXOTransaction.js'
import {
  sendUTXOTransaction,
  type SendUTXOTransactionParameters,
  type SendUTXOTransactionReturnType,
} from '../actions/sendUTXOTransaction.js'

export type UTXOActions = {
  getBlockCount: () => Promise<GetBlockCountReturnType>
  sendUTXOTransaction: (
    args: SendUTXOTransactionParameters
  ) => Promise<SendUTXOTransactionReturnType>
  getUTXOTransaction: (
    args: GetUTXOTransactionParameters
  ) => Promise<GetUTXOTransactionReturnType>
}

export function UTXOActions<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined,
  account extends Account | undefined = Account | undefined,
>(client: Client<transport, chain, account>): UTXOActions {
  return {
    getBlockCount: () => getBlockCount(client),
    sendUTXOTransaction: (args) => sendUTXOTransaction(client, args),
    getUTXOTransaction: (args) => getUTXOTransaction(client, args),
  }
}
