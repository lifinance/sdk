import type { Address, Transaction } from '@solana/kit'
import {
  type Blockhash,
  getCompiledTransactionMessageEncoder,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { extractBlockhash } from './extractBlockhash.js'

const SYSTEM_PROGRAM_ADDRESS =
  '11111111111111111111111111111111' as Address<'11111111111111111111111111111111'>

const encoder = getCompiledTransactionMessageEncoder()

const TEST_BLOCKHASH = 'EETubP5AKHgjPAhzPkA6E6SFrmFW6V5a5kWvs97PFb91'
const TEST_NONCE = '7BpFqxP4VEXCVnT8HXMQ2KGeVxfmPz4dMwYSnFBHNzqL'

function buildTransaction(
  compiledMessage: Parameters<typeof encoder.encode>[0]
): Transaction {
  const messageBytes = encoder.encode(compiledMessage)
  return { messageBytes, signatures: {} } as unknown as Transaction
}

function makeBlockhashTx(): Transaction {
  const feePayer = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS' as Address
  return buildTransaction({
    version: 'legacy' as const,
    header: {
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 0,
    },
    staticAccounts: [feePayer],
    lifetimeToken: TEST_BLOCKHASH,
    instructions: [],
  })
}

function makeNonceTx(): Transaction {
  const feePayer = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS' as Address
  const nonceAccount = '5ZWj7a1f8tWkjBESHKgrLCQvJe2WLAd5PPQGZ7j7rjST' as Address
  const nonceAuthority =
    'GjKC3UPRsFs9oRH7x6L2RQFCcgr1mEE6sWG8vqKB3tP1' as Address
  const recentBlockhashSysvar =
    'SysvarRecentB1ockHashes11111111111111111111' as Address

  return buildTransaction({
    version: 'legacy' as const,
    header: {
      numSignerAccounts: 2,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 2,
    },
    staticAccounts: [
      feePayer,
      nonceAuthority,
      nonceAccount,
      recentBlockhashSysvar,
      SYSTEM_PROGRAM_ADDRESS,
    ],
    lifetimeToken: TEST_NONCE,
    instructions: [
      {
        programAddressIndex: 4,
        accountIndices: [2, 3, 1],
        data: new Uint8Array([4, 0, 0, 0]),
      },
    ],
  })
}

describe('extractBlockhash', () => {
  it('returns the blockhash for a blockhash-lifetime transaction', async () => {
    const tx = makeBlockhashTx()
    const result = await extractBlockhash(tx)
    expect(result).toBe(TEST_BLOCKHASH as Blockhash)
  })

  it('returns null for a durable-nonce transaction', async () => {
    const tx = makeNonceTx()
    const result = await extractBlockhash(tx)
    expect(result).toBeNull()
  })
})
