import {
  type Address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  getBase58Encoder,
  getTransactionCodec,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { SolanaSignTransaction } from '@solana/wallet-standard-features'
import { describe, expect, it } from 'vitest'
import { generateTestKeypair } from './KeypairWallet.unit.helpers.js'
import { KeypairWalletAdapter } from './KeypairWalletAdapter.js'

const BLOCKHASH = 'AYXSiaZKAaLa8gQ6MXDBeaehHBoWpoYdygPx4kK3rte6' as Blockhash

/**
 * Builds a transaction the way the backend delivers one: compiled to wire
 * bytes, which is the only form the wallet ever receives. Decoding those bytes
 * yields `{ messageBytes, signatures }` and nothing else - notably no
 * `lifetimeConstraint`, because no kit decoder reconstructs it.
 */
const buildWireTransaction = (feePayer: Address): Uint8Array => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
        m
      ),
    (m) =>
      appendTransactionMessageInstruction(
        { programAddress: '11111111111111111111111111111111' as Address },
        m
      )
  )
  const compiled = compileTransaction(message)
  return new Uint8Array(getTransactionCodec().encode(compiled))
}

describe('KeypairWalletAdapter signing', () => {
  it('signs a wire transaction and returns the signature in the output', async () => {
    // The wallet always receives wire bytes, so this is the only shape that
    // matters. Two defects lived here: an assert on `lifetimeConstraint`,
    // which no decoder populates, rejected every real transaction; and the
    // result encoded the pre-signing object, discarding the signature that
    // had just been produced.
    const { secretKey } = await generateTestKeypair()
    const wallet = new KeypairWalletAdapter(secretKey)
    await wallet.connect()

    const account = wallet.accounts[0]
    const wire = buildWireTransaction(account.address as Address)

    const feature = wallet.features[SolanaSignTransaction]
    const [output] = await feature.signTransaction({
      account,
      transaction: wire,
    })

    const signed = getTransactionCodec().decode(output.signedTransaction)
    const signature = signed.signatures[account.address as Address]

    expect(signature).toBeDefined()
    expect(signature).not.toBeNull()
    // 64 zero bytes is the unsigned placeholder the compiler emits. Encoding
    // the wrong object returns exactly that, so a mere presence check passes
    // against the bug.
    expect(signature).not.toEqual(new Uint8Array(64))
    expect(signature?.length).toBe(64)
  })

  it('produces a signature that verifies against the message bytes', async () => {
    // Proves the bytes signed are this transaction's, not a leftover from
    // some other object in the pipeline.
    const { secretKey } = await generateTestKeypair()
    const wallet = new KeypairWalletAdapter(secretKey)
    await wallet.connect()

    const account = wallet.accounts[0]
    const wire = buildWireTransaction(account.address as Address)

    const feature = wallet.features[SolanaSignTransaction]
    const [output] = await feature.signTransaction({
      account,
      transaction: wire,
    })

    const signed = getTransactionCodec().decode(output.signedTransaction)
    const signature = signed.signatures[account.address as Address]

    // Copied into fresh Uint8Arrays: WebCrypto's BufferSource wants an
    // ArrayBuffer-backed view, and kit's branded byte types are not that.
    const toBytes = (value: ArrayLike<number>): Uint8Array<ArrayBuffer> => {
      const bytes = new Uint8Array(new ArrayBuffer(value.length))
      bytes.set(Array.from(value))
      return bytes
    }

    const publicKey = await crypto.subtle.importKey(
      'raw',
      toBytes(getBase58Encoder().encode(account.address)),
      { name: 'Ed25519' },
      true,
      ['verify']
    )
    const verified = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      toBytes(signature as unknown as ArrayLike<number>),
      toBytes(signed.messageBytes)
    )
    expect(verified).toBe(true)
  })
})
