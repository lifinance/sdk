/**
 * Network-level harness for the Bitcoin money-path flow specs
 * (`*.flow.spec.ts` beside this file).
 *
 * The specs drive the real SDK end to end: `executeRoute` / `resumeRoute` →
 * `BitcoinProvider.getStepExecutor` → the real `BitcoinStepExecutor` and its
 * real task pipeline → the real bigmi public client (`fallback` of
 * blockchair, blockcypher, mempool and one `http` JSON-RPC transport). Only
 * the network and the wallet key are fake:
 *
 * - `globalThis.fetch` (every bigmi transport calls it through
 *   `getHttpRpcClient`):
 *   - the Bitcoin node at {@link BTC_RPC_URL} (JSON-RPC: `getblockcount`,
 *     `getrawtransaction`, `getblockstats`, `getblockhash`, `getblock`,
 *     `sendrawtransaction`). It keeps an in-memory chain: UTXOs, a mempool
 *     and real blocks (bitcoinjs-lib `Block` hex). It verifies the signature
 *     of every input it gets. An accepted transaction is mined at once, so
 *     the first poll of `waitForTransaction` finds it confirmed;
 *   - blockchair's balance endpoint (the first transport bigmi asks for
 *     `getBalance`);
 *   - the LI.FI API (`/advanced/stepTransaction`, `/status`). Each quote is
 *     a real PSBT that spends the wallet's UTXOs.
 * - The wallet: a bigmi client with a `custom` transport whose `signPsbt`
 *   signs with a real throwaway secp256k1 key (p2wpkh), so every signature
 *   and txid is real. `signPsbt` is spied.
 *
 * Anything else (an unknown URL or method, an invalid signature, a `/status`
 * for a hash that is not a mined deposit to the bridge vault) is recorded in
 * {@link FakeBitcoinNetwork.unexpected}, which every spec asserts is empty in
 * `afterEach`. A throw inside a fake is recorded there too
 * (`harness error: …`), then rethrown. Main swallows many errors (the bigmi
 * fallback, the `/status` poll), so a throw alone could hide.
 *
 * A page is a fresh module graph: {@link openPage} calls `vi.resetModules()`
 * and imports `@lifi/sdk` and the provider again, so the provider's
 * `publicClients` cache, core `executionState` and
 * `TRANSACTION_HASH_OBSERVERS` start empty on every page, as after a browser
 * page load. `@bigmi/core` and `bitcoinjs-lib` are external modules, so they
 * are shared; bigmi's observer caches are keyed by the client `uid`, which
 * is new on every page. Specs call `executeRoute` and `resumeRoute` only
 * through the page ({@link Page.executeRoute}), never from a static import.
 *
 * `.mock.ts` keeps this file out of `dist`.
 */
import {
  cleanupCache,
  createClient as createBigmiClient,
  custom,
  listenersCache,
  type SignPsbtParameters,
  UserRejectedRequestError,
} from '@bigmi/core'
import * as ecc from '@bitcoinerlab/secp256k1'
import {
  ChainId,
  ChainType,
  type ExecutionOptions,
  type ExtendedChain,
  type LiFiStep,
  type LiFiStepExtended,
  type Route,
  type RouteExtended,
  type SDKClient,
  type Token,
} from '@lifi/sdk'
import {
  Block,
  address as btcAddress,
  crypto as btcCrypto,
  networks,
  Psbt,
  payments,
  type Signer,
  script,
  Transaction,
} from 'bitcoinjs-lib'
import { type Mock, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const API_URL = 'https://api.lifi.test/v1'
/**
 * The only JSON-RPC URL: the SDK config and `metamask.rpcUrls` name the same
 * one, so the public client has exactly one `http` transport.
 */
export const BTC_RPC_URL = 'https://bitcoin-rpc.test'
/** bigmi's blockchair transport for chain name "Bitcoin" (fixed by bigmi). */
export const BLOCKCHAIR_URL = 'https://api.blockchair.com/bitcoin'
/** `fromChain.metamask.blockExplorerUrls[0]`: the provider's `txLink` base. */
export const BTC_EXPLORER_URL = 'https://mempool.test/'
export const ARB_EXPLORER_URL = 'https://arbiscan.test/'

/** The one UTXO every new wallet holds: 0.01 BTC. */
export const WALLET_BALANCE = 1_000_000n
/** `step.action.fromAmount`: 0.005 BTC. */
export const FROM_AMOUNT = '500000'
/** The fee of every quoted PSBT (about 12 sat/vB). */
export const QUOTE_FEE = 2_000n
/** What the wallet adds to the fee when the user speeds a transaction up. */
export const SPEED_UP_EXTRA_FEE = 3_000n
/** The fee of the transaction that cancels a quoted one. */
export const CANCEL_FEE = 6_000n
/** `step.estimate.toAmount` of every quote (USDC, 6 decimals). */
export const ESTIMATED_TO_AMOUNT = '430000000'
/** What `/status` says arrived on Arbitrum. */
export const BRIDGE_RECEIVED_AMOUNT = '429500000'
/** `step.action.toAddress`: an EVM wallet. */
export const BRIDGE_TO_ADDRESS = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0'
/** The bridge's deposit address (p2wpkh of twenty 0x11 bytes). */
export const VAULT_ADDRESS: string = payments.p2wpkh({
  hash: new Uint8Array(20).fill(0x11),
  network: networks.bitcoin,
}).address as string
/** Height of the chain tip before any spec transaction. */
export const START_HEIGHT = 900_000
/** What the fake wallet throws when the user rejects. */
export const USER_REJECTION_MESSAGE = 'User rejected the request.'

export const BTC_TOKEN: Token = {
  address: 'bitcoin',
  chainId: ChainId.BTC,
  symbol: 'BTC',
  decimals: 8,
  name: 'Bitcoin',
  coinKey: 'BTC',
  priceUSD: '86000',
  logoURI: '',
} as Token

export const ARB_USDC_TOKEN: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  chainId: ChainId.ARB,
  symbol: 'USDC',
  decimals: 6,
  name: 'USD Coin',
  coinKey: 'USDC',
  priceUSD: '1',
  logoURI: '',
} as Token

const BTC_CHAIN = {
  id: ChainId.BTC,
  key: 'btc',
  chainType: ChainType.UTXO,
  name: 'Bitcoin',
  coin: 'BTC',
  mainnet: true,
  logoURI: '',
  metamask: {
    chainId: String(ChainId.BTC),
    chainName: 'Bitcoin',
    nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 8 },
    rpcUrls: [BTC_RPC_URL],
    blockExplorerUrls: [BTC_EXPLORER_URL],
  },
} as unknown as ExtendedChain

const ARB_CHAIN = {
  id: ChainId.ARB,
  key: 'arb',
  chainType: ChainType.EVM,
  name: 'Arbitrum',
  coin: 'ETH',
  mainnet: true,
  logoURI: '',
  metamask: {
    chainId: '0xa4b1',
    chainName: 'Arbitrum',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb-rpc.test'],
    blockExplorerUrls: [ARB_EXPLORER_URL],
  },
} as unknown as ExtendedChain

/** The destination hash the fake `/status` reports for a source txid. */
export const destinationTxHashOf = (txid: string): string => `0x${txid}`

let routeCounter = 0

/**
 * A one-step bridge route (BTC → USDC on Arbitrum) as `/advanced/routes`
 * returns it: no `transactionRequest`, so the first run asks
 * `/advanced/stepTransaction`. Route and step ids are unique per call
 * (execution state is keyed by route id).
 */
export const buildRoute = (walletAddress: string): Route => {
  routeCounter += 1
  const tool = 'thorswap'
  const step = {
    id: `btc-flow-step-${routeCounter}`,
    type: 'cross',
    tool,
    toolDetails: { key: tool, name: tool, logoURI: '' },
    action: {
      fromChainId: ChainId.BTC,
      toChainId: ChainId.ARB,
      fromToken: BTC_TOKEN,
      toToken: ARB_USDC_TOKEN,
      fromAmount: FROM_AMOUNT,
      slippage: 0.005,
      fromAddress: walletAddress,
      toAddress: BRIDGE_TO_ADDRESS,
    },
    estimate: {
      tool,
      fromAmount: FROM_AMOUNT,
      fromAmountUSD: '430',
      toAmount: ESTIMATED_TO_AMOUNT,
      toAmountMin: '427850000',
      toAmountUSD: '430',
      approvalAddress: '',
      executionDuration: 600,
      feeCosts: [],
      gasCosts: [
        {
          type: 'SEND',
          price: '12',
          estimate: '170',
          limit: '170',
          amount: String(QUOTE_FEE),
          amountUSD: '1.72',
          token: BTC_TOKEN,
        },
      ],
    },
    includedSteps: [],
  } as unknown as LiFiStep
  return {
    id: `btc-flow-route-${routeCounter}`,
    fromChainId: ChainId.BTC,
    toChainId: ChainId.ARB,
    fromAmount: FROM_AMOUNT,
    fromAmountUSD: '430',
    fromToken: BTC_TOKEN,
    toToken: ARB_USDC_TOKEN,
    toAmount: ESTIMATED_TO_AMOUNT,
    toAmountMin: '427850000',
    toAmountUSD: '430',
    fromAddress: walletAddress,
    toAddress: BRIDGE_TO_ADDRESS,
    gasCostUSD: '1.72',
    steps: [step],
    insurance: { feeAmountUsd: '0', state: 'NOT_INSURABLE' },
  } as unknown as Route
}

// ---------------------------------------------------------------------------
// Wallet keys
// ---------------------------------------------------------------------------

export interface WalletKey {
  readonly publicKey: Uint8Array
  /** The p2wpkh (bc1q…) address of the key. */
  readonly address: string
  /** Signs bitcoinjs-lib sighashes with the private key. */
  readonly signer: Signer
}

/** A new random secp256k1 key with its p2wpkh address. */
export const createWalletKey = (): WalletKey => {
  let privateKey = globalThis.crypto.getRandomValues(new Uint8Array(32))
  while (!ecc.isPrivate(privateKey)) {
    privateKey = globalThis.crypto.getRandomValues(new Uint8Array(32))
  }
  const publicKey = ecc.pointFromScalar(privateKey, true) as Uint8Array
  return {
    publicKey,
    address: payments.p2wpkh({ pubkey: publicKey, network: networks.bitcoin })
      .address as string,
    signer: {
      publicKey,
      sign: (hash: Uint8Array): Uint8Array => ecc.sign(hash, privateKey),
    },
  }
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))

// ---------------------------------------------------------------------------
// Fake Bitcoin node, blockchair and LI.FI API
// ---------------------------------------------------------------------------

/** How the user replaces a transaction in their wallet (RBF). */
export type ReplacementKind = 'repriced' | 'cancelled'

interface Utxo {
  txid: string
  vout: number
  value: bigint
  script: Uint8Array
}

interface ChainBlock {
  height: number
  hash: string
  hex: string
  txids: string[]
}

interface RpcError {
  code: number
  message: string
}

export interface FakeBitcoinNetwork {
  /** Raw hex of every `sendrawtransaction` request, in order. */
  readonly sent: string[]
  /** Every JSON-RPC method the node got, in order. */
  readonly rpcMethods: string[]
  /** Calls and requests the fakes do not expect (must stay empty). */
  readonly unexpected: string[]
  /** The address of each blockchair balance read, in order. */
  readonly balanceReads: string[]
  /** Bodies of the `/advanced/stepTransaction` requests, in order. */
  readonly stepTransactionRequests: LiFiStep[]
  /** The PSBT hex of each `/advanced/stepTransaction` answer, in order. */
  readonly quotes: string[]
  /** Query parameters of each `/status` request, in order. */
  readonly statusRequests: Record<string, string>[]
  /** txid of each replacement the user's wallet broadcast, in order. */
  readonly replacements: string[]
  /**
   * The user replaces the next transaction the node accepts (RBF, signed in
   * the wallet app, outside the SDK). The replacement is mined in place of
   * the original; the original is evicted and the node answers -5 for it.
   */
  replaceNextSend: ReplacementKind | undefined
  /** Gives the key's address one confirmed UTXO of `WALLET_BALANCE`. */
  addWallet(key: WalletKey): void
  /** The confirmed balance of an address, in satoshi. */
  balanceOf(address: string): bigint
  /** True when the txid is in a block. */
  isMined(txid: string): boolean
  fetch: typeof fetch
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const urlOf = (input: unknown): string =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : (input as Request).url

const NO_SUCH_TRANSACTION: RpcError = {
  code: -5,
  message:
    'No such mempool or blockchain transaction. Use gettransaction for wallet transactions.',
}

let quoteCounter = 0
let fundingCounter = 0

const createFakeBitcoinNetwork = (): FakeBitcoinNetwork => {
  const utxos = new Map<string, Utxo>()
  const wallets = new Map<string, WalletKey>()
  const transactions = new Map<string, Transaction>()
  const mempool = new Set<string>()
  const minedAt = new Map<string, ChainBlock>()
  const blocks: ChainBlock[] = []
  const outpoint = (txid: string, vout: number): string => `${txid}:${vout}`
  const tip = (): ChainBlock => blocks[blocks.length - 1]

  const coinbase = (height: number): Transaction => {
    const tx = new Transaction()
    tx.version = 2
    tx.addInput(
      new Uint8Array(32),
      0xffffffff,
      0xffffffff,
      script.compile([script.number.encode(height)])
    )
    tx.addOutput(
      payments.p2wpkh({ hash: new Uint8Array(20).fill(0x22) })
        .output as Uint8Array,
      312_500_000n
    )
    return tx
  }

  /** Mines a block with a coinbase and `txs`, on top of the tip. */
  const mine = (txs: Transaction[]): void => {
    const height = blocks.length ? tip().height + 1 : START_HEIGHT
    const block = new Block()
    block.version = 0x20000000
    block.prevHash = blocks.length
      ? fromHex(tip().hash).reverse()
      : new Uint8Array(32)
    block.transactions = [coinbase(height), ...txs]
    block.merkleRoot = Block.calculateMerkleRoot(block.transactions)
    block.timestamp = 1_790_000_000 + (height - START_HEIGHT) * 600
    block.bits = 0x17034219
    block.nonce = height
    const mined: ChainBlock = {
      height,
      hash: block.getId(),
      hex: block.toHex(),
      txids: block.transactions.map((tx) => tx.getId()),
    }
    blocks.push(mined)
    for (const tx of txs) {
      mempool.delete(tx.getId())
      minedAt.set(tx.getId(), mined)
    }
  }
  mine([])

  /** Spends the inputs of `tx` and adds its outputs to the UTXO set. */
  const apply = (tx: Transaction): void => {
    const txid = tx.getId()
    for (const input of tx.ins) {
      utxos.delete(
        outpoint(toHex(Uint8Array.from(input.hash).reverse()), input.index)
      )
    }
    tx.outs.forEach((output, vout) => {
      utxos.set(outpoint(txid, vout), {
        txid,
        vout,
        value: output.value,
        script: output.script,
      })
    })
    transactions.set(txid, tx)
  }

  /** Undoes `apply` for a transaction that is evicted from the mempool. */
  const evict = (tx: Transaction, spent: Utxo[]): void => {
    const txid = tx.getId()
    tx.outs.forEach((_output, vout) => {
      utxos.delete(outpoint(txid, vout))
    })
    for (const utxo of spent) {
      utxos.set(outpoint(utxo.txid, utxo.vout), utxo)
    }
    mempool.delete(txid)
    transactions.delete(txid)
  }

  const addressOf = (outputScript: Uint8Array): string | undefined => {
    try {
      return btcAddress.fromOutputScript(outputScript, networks.bitcoin)
    } catch {
      return undefined
    }
  }

  /** The p2wpkh signature check of input `index` against its UTXO. */
  const verifyInput = (tx: Transaction, index: number, utxo: Utxo): boolean => {
    const [encodedSignature, publicKey] = tx.ins[index].witness
    if (!encodedSignature || !publicKey) {
      return false
    }
    const program = payments.p2wpkh({ output: utxo.script }).hash
    if (!program || toHex(btcCrypto.hash160(publicKey)) !== toHex(program)) {
      return false
    }
    const { signature, hashType } = script.signature.decode(encodedSignature)
    const sighash = tx.hashForWitnessV0(
      index,
      payments.p2pkh({ pubkey: publicKey }).output as Uint8Array,
      utxo.value,
      hashType
    )
    return ecc.verify(sighash, publicKey, signature)
  }

  /** What the user's wallet broadcasts to replace `original` (RBF). */
  const buildReplacement = (
    original: Transaction,
    spent: Utxo[],
    kind: ReplacementKind
  ): Transaction => {
    const sender = addressOf(spent[0].script) as string
    const key = wallets.get(sender) as WalletKey
    const psbt = new Psbt({ network: networks.bitcoin })
    original.ins.forEach((input, index) => {
      psbt.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: { script: spent[index].script, value: spent[index].value },
      })
    })
    if (kind === 'cancelled') {
      const total = spent.reduce((sum, utxo) => sum + utxo.value, 0n)
      psbt.addOutput({ address: sender, value: total - CANCEL_FEE })
    } else {
      for (const output of original.outs) {
        const isChange = addressOf(output.script) === sender
        psbt.addOutput({
          script: output.script,
          value: isChange ? output.value - SPEED_UP_EXTRA_FEE : output.value,
        })
      }
    }
    psbt.signAllInputs(key.signer)
    psbt.finalizeAllInputs()
    return psbt.extractTransaction()
  }

  const sendRawTransaction = (hex: string): string | RpcError => {
    let tx: Transaction
    try {
      tx = Transaction.fromHex(hex)
    } catch {
      return {
        code: -22,
        message: 'TX decode failed. Make sure the tx has at least one input.',
      }
    }
    const txid = tx.getId()
    if (minedAt.has(txid)) {
      return { code: -27, message: 'Transaction outputs already in utxo set' }
    }
    if (mempool.has(txid)) {
      return txid
    }
    const spent: Utxo[] = []
    for (const [index, input] of tx.ins.entries()) {
      const utxo = utxos.get(
        outpoint(toHex(Uint8Array.from(input.hash).reverse()), input.index)
      )
      if (!utxo) {
        return { code: -25, message: 'bad-txns-inputs-missingorspent' }
      }
      if (!verifyInput(tx, index, utxo)) {
        network.unexpected.push(`invalid signature for ${txid}:${index}`)
        return {
          code: -26,
          message:
            'mandatory-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)',
        }
      }
      spent.push(utxo)
    }
    apply(tx)
    mempool.add(txid)
    const replacement = network.replaceNextSend
    if (replacement) {
      network.replaceNextSend = undefined
      const replacing = buildReplacement(tx, spent, replacement)
      evict(tx, spent)
      apply(replacing)
      network.replacements.push(replacing.getId())
      mine([replacing])
    } else {
      mine([tx])
    }
    return txid
  }

  /** `getrawtransaction [txid, true]` as Bitcoin Core answers it. */
  const verboseTransaction = (txid: string): object | RpcError => {
    const tx = transactions.get(txid)
    if (!tx) {
      return NO_SUCH_TRANSACTION
    }
    const block = minedAt.get(txid)
    return {
      txid,
      hash: toHex(tx.getHash(true).reverse()),
      version: tx.version,
      size: tx.byteLength(),
      vsize: tx.virtualSize(),
      weight: tx.weight(),
      locktime: tx.locktime,
      vin: tx.ins.map((input) => ({
        txid: toHex(Uint8Array.from(input.hash).reverse()),
        vout: input.index,
        scriptSig: { asm: '', hex: toHex(input.script) },
        txinwitness: input.witness.map(toHex),
        sequence: input.sequence,
      })),
      vout: tx.outs.map((output, n) => ({
        value: Number(output.value) / 1e8,
        n,
        scriptPubKey: {
          hex: toHex(output.script),
          ...(addressOf(output.script) && {
            address: addressOf(output.script),
          }),
        },
      })),
      hex: tx.toHex(),
      ...(block && {
        blockhash: block.hash,
        confirmations: tip().height - block.height + 1,
        time: 1_790_000_000 + (block.height - START_HEIGHT) * 600,
        blocktime: 1_790_000_000 + (block.height - START_HEIGHT) * 600,
      }),
    }
  }

  const rpc = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case 'getblockcount':
        return tip().height
      case 'getrawtransaction':
        return verboseTransaction(String(params[0]))
      case 'getblockstats': {
        const block = blocks.find((candidate) => candidate.hash === params[0])
        return block
          ? { height: block.height }
          : { code: -5, message: 'Block not found' }
      }
      case 'getblockhash': {
        const block = blocks.find((candidate) => candidate.height === params[0])
        return block
          ? block.hash
          : { code: -8, message: 'Block height out of range' }
      }
      case 'getblock': {
        const block = blocks.find((candidate) => candidate.hash === params[0])
        return block ? block.hex : { code: -5, message: 'Block not found' }
      }
      case 'sendrawtransaction':
        network.sent.push(String(params[0]))
        return sendRawTransaction(String(params[0]))
      default:
        network.unexpected.push(`rpc ${method}`)
        return { code: -32601, message: 'Method not found' }
    }
  }

  const isRpcError = (value: unknown): value is RpcError =>
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    !('txid' in value)

  /** A PSBT that spends every UTXO of `fromAddress` to the bridge vault. */
  const buildQuotePsbt = (step: LiFiStep): string => {
    quoteCounter += 1
    const fromAddress = step.action.fromAddress as string
    const owned = [...utxos.values()].filter(
      (utxo) =>
        addressOf(utxo.script) === fromAddress &&
        minedAt.has(utxo.txid) &&
        !mempool.has(utxo.txid)
    )
    const total = owned.reduce((sum, utxo) => sum + utxo.value, 0n)
    const psbt = new Psbt({ network: networks.bitcoin })
    for (const utxo of owned) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: 0xfffffffd,
        witnessUtxo: { script: utxo.script, value: utxo.value },
      })
    }
    const amount = BigInt(step.action.fromAmount)
    psbt.addOutput({ address: VAULT_ADDRESS, value: amount })
    psbt.addOutput({
      script: payments.embed({
        data: [
          new TextEncoder().encode(
            `=:ARB.USDC:${step.action.toAddress}:${quoteCounter}`
          ),
        ],
      }).output as Uint8Array,
      value: 0n,
    })
    psbt.addOutput({
      address: fromAddress,
      value: total - amount - QUOTE_FEE,
    })
    return psbt.toHex()
  }

  /** True when `txid` is in a block and pays the bridge vault. */
  const paysVault = (txid: string): boolean =>
    minedAt.has(txid) &&
    (transactions.get(txid)?.outs ?? []).some(
      (output) => addressOf(output.script) === VAULT_ADDRESS
    )

  const statusAnswer = (txHash: string, query: Record<string, string>) => {
    const receivingHash = destinationTxHashOf(txHash)
    return {
      status: 'DONE',
      substatus: 'COMPLETED',
      tool: query.bridge,
      sending: {
        txHash,
        txLink: `${BTC_EXPLORER_URL}tx/${txHash}`,
        chainId: ChainId.BTC,
        amount: FROM_AMOUNT,
        token: BTC_TOKEN,
        gasPrice: '12',
        gasUsed: '170',
        gasToken: BTC_TOKEN,
        gasAmount: String(QUOTE_FEE),
        gasAmountUSD: '1.72',
        timestamp: 1,
      },
      receiving: {
        txHash: receivingHash,
        txLink: `${ARB_EXPLORER_URL}tx/${receivingHash}`,
        chainId: ChainId.ARB,
        amount: BRIDGE_RECEIVED_AMOUNT,
        token: ARB_USDC_TOKEN,
        timestamp: 2,
      },
    }
  }

  const network: FakeBitcoinNetwork = {
    sent: [],
    rpcMethods: [],
    unexpected: [],
    balanceReads: [],
    stepTransactionRequests: [],
    quotes: [],
    statusRequests: [],
    replacements: [],
    replaceNextSend: undefined,
    addWallet(key) {
      if (wallets.has(key.address)) {
        return
      }
      wallets.set(key.address, key)
      fundingCounter += 1
      const funding = new Transaction()
      funding.version = 2
      funding.addInput(fromHex(`${fundingCounter}`.padStart(64, 'f')), 0)
      funding.addOutput(
        payments.p2wpkh({ pubkey: key.publicKey }).output as Uint8Array,
        WALLET_BALANCE
      )
      apply(funding)
      mine([funding])
    },
    balanceOf(owner) {
      return [...utxos.values()]
        .filter(
          (utxo) => addressOf(utxo.script) === owner && minedAt.has(utxo.txid)
        )
        .reduce((sum, utxo) => sum + utxo.value, 0n)
    },
    isMined(txid) {
      return minedAt.has(txid)
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input)
      if (url === BTC_RPC_URL) {
        const body = JSON.parse(String(init?.body)) as {
          id: number
          method: string
          params: unknown[]
        }
        network.rpcMethods.push(body.method)
        const result = rpc(body.method, body.params ?? [])
        return isRpcError(result)
          ? json({ jsonrpc: '2.0', error: result, id: body.id })
          : json({ jsonrpc: '2.0', result, id: body.id })
      }
      if (url.startsWith(`${BLOCKCHAIR_URL}/addresses/balances?`)) {
        const owner = new URL(url).searchParams.get('addresses') ?? ''
        network.balanceReads.push(owner)
        return json({
          data: { [owner]: Number(network.balanceOf(owner)) },
          context: { code: 200 },
        })
      }
      if (url === `${API_URL}/advanced/stepTransaction`) {
        const requested = JSON.parse(String(init?.body)) as LiFiStep
        network.stepTransactionRequests.push(requested)
        const data = buildQuotePsbt(requested)
        network.quotes.push(data)
        return json({ ...requested, transactionRequest: { data } })
      }
      if (url.startsWith(`${API_URL}/status?`)) {
        const query = Object.fromEntries(new URL(url).searchParams)
        network.statusRequests.push(query)
        const txHash = query.txHash ?? ''
        if (!paysVault(txHash)) {
          // The bridge knows only a mined deposit to its vault. Main polls
          // `/status` forever while the answer is not DONE, so any other
          // hash answers DONE without `receiving`: main then fails at once
          // instead of hanging.
          network.unexpected.push(`/status for unknown hash ${txHash}`)
          return json({ status: 'DONE', substatus: 'COMPLETED' })
        }
        return json(statusAnswer(txHash, query))
      }
      network.unexpected.push(`fetch ${url}`)
      return json({ message: `Unexpected request ${url}` }, 404)
    }) as typeof fetch,
  }
  return network
}

/**
 * The URL of a request, and its JSON-RPC method (a node request) or its
 * path (any other URL). Never throws: it names a request that just failed.
 */
const describeRequest = (
  input: unknown,
  init?: RequestInit
): { name: string; url: string } => {
  let url = 'unknown url'
  try {
    url = urlOf(input)
    const name =
      url === BTC_RPC_URL
        ? String((JSON.parse(String(init?.body)) as { method: unknown }).method)
        : new URL(url).pathname
    return { name, url }
  } catch {
    return { name: 'request', url }
  }
}

/**
 * A transport failure that a spec makes on purpose for a send (the
 * phase-2 resume spec's `failNextSend`): the connection fails (`fetch`
 * throws `TypeError: fetch failed`), or bigmi's timeout aborts the request.
 * Not a harness error.
 */
const isSimulatedSendFailure = (
  name: string,
  error: unknown,
  init?: RequestInit
): boolean =>
  name === 'sendrawtransaction' &&
  ((error instanceof TypeError && error.message === 'fetch failed') ||
    (init?.signal?.aborted === true &&
      error instanceof Error &&
      error.name === 'AbortError'))

/**
 * `network.fetch` with a try/catch around it: a throw inside a fake (a
 * parse, a spec callback) is recorded in `unexpected` as
 * `harness error: <method or path> on <url>: <message>`, then rethrown.
 * bigmi's fallback and the SDK swallow many transport errors, so a throw
 * alone could hide.
 */
const guarded = (network: FakeBitcoinNetwork): typeof fetch =>
  (async (input: unknown, init?: RequestInit) => {
    try {
      return await network.fetch(input as RequestInfo, init)
    } catch (error) {
      const { name, url } = describeRequest(input, init)
      if (!isSimulatedSendFailure(name, error, init)) {
        const message = error instanceof Error ? error.message : String(error)
        network.unexpected.push(`harness error: ${name} on ${url}: ${message}`)
      }
      throw error
    }
  }) as typeof fetch

/**
 * A new fake network for one spec; `globalThis.fetch` is its handler,
 * guarded. Undo with `vi.unstubAllGlobals()` in `afterEach`.
 */
export const installFakeBitcoinNetwork = (): FakeBitcoinNetwork => {
  const network = createFakeBitcoinNetwork()
  vi.stubGlobal('fetch', guarded(network))
  return network
}

// ---------------------------------------------------------------------------
// One "page": a fresh SDK module graph, a provider, a wallet and a client
// ---------------------------------------------------------------------------

export interface Page {
  readonly client: SDKClient
  /** `executeRoute` of this page's `@lifi/sdk` instance, bound to `client`. */
  readonly executeRoute: (
    route: Route,
    options?: ExecutionOptions
  ) => Promise<RouteExtended>
  /** `resumeRoute` of this page's `@lifi/sdk` instance, bound to `client`. */
  readonly resumeRoute: (
    route: Route,
    options?: ExecutionOptions
  ) => Promise<RouteExtended>
  /** The wallet's `signPsbt` handler, spied (it still signs). */
  readonly signPsbt: Mock<(params: SignPsbtParameters) => Promise<string>>
  readonly key: WalletKey
  readonly walletAddress: string
}

/**
 * Builds what one page load builds. `vi.resetModules()` first, so this page
 * has its own `@lifi/sdk` and provider modules (empty caches). Pass the key
 * of an earlier page to reload with the same wallet.
 */
export const openPage = async (
  network: FakeBitcoinNetwork,
  key: WalletKey = createWalletKey()
): Promise<Page> => {
  vi.resetModules()
  const sdk = await import('@lifi/sdk')
  const { BitcoinProvider } = await import('../../BitcoinProvider.js')
  network.addWallet(key)

  const signPsbt = vi.fn(async (params: SignPsbtParameters) => {
    const psbt = Psbt.fromHex(params.psbt, { network: networks.bitcoin })
    for (const input of params.inputsToSign) {
      if (input.address !== key.address) {
        network.unexpected.push(`signPsbt for foreign address ${input.address}`)
        continue
      }
      for (const index of input.signingIndexes) {
        psbt.signInput(index, key.signer, [input.sigHash ?? 1])
      }
    }
    if (params.finalize) {
      psbt.finalizeAllInputs()
    }
    return psbt.toHex()
  })
  const walletClient = createBigmiClient({
    account: {
      address: key.address,
      addressType: 'p2wpkh',
      publicKey: toHex(key.publicKey),
      purpose: 'payment',
    } as never,
    transport: custom({
      async request({ method, params }: { method: string; params: unknown }) {
        if (method !== 'signPsbt') {
          network.unexpected.push(`wallet ${method}`)
          throw new Error(`Fake wallet: ${method} is not implemented`)
        }
        return signPsbt(params as SignPsbtParameters)
      },
    }),
  })

  const client = sdk.createClient({
    integrator: 'bitcoin-flow-specs',
    apiUrl: API_URL,
    preloadChains: false,
    disableVersionCheck: true,
    providers: [
      BitcoinProvider({ getWalletClient: async () => walletClient as never }),
    ],
    rpcUrls: { [ChainId.BTC]: [BTC_RPC_URL] },
  })
  client.setChains([BTC_CHAIN, ARB_CHAIN])
  return {
    client,
    executeRoute: (route, options) => sdk.executeRoute(client, route, options),
    resumeRoute: (route, options) => sdk.resumeRoute(client, route, options),
    signPsbt,
    key,
    walletAddress: key.address,
  }
}

/** The user rejects the next `signPsbt` request of this page's wallet. */
export const rejectNextSignature = (page: Page): void => {
  page.signPsbt.mockRejectedValueOnce(
    new UserRejectedRequestError(USER_REJECTION_MESSAGE)
  )
}

/** The raw transaction a signed PSBT finalizes to (what the SDK sends). */
export const finalizedHexOf = (signedPsbtHex: string): string => {
  const psbt = Psbt.fromHex(signedPsbtHex, { network: networks.bitcoin })
  psbt.finalizeAllInputs()
  return psbt.extractTransaction().toHex()
}

/** The txid of a raw transaction hex. */
export const txidOf = (hex: string): string => Transaction.fromHex(hex).getId()

/** The signed PSBT each settled `signPsbt` call returned, in order. */
export const signedPsbts = async (page: Page): Promise<string[]> => {
  const settled = await Promise.allSettled(
    page.signPsbt.mock.results.map((result) => result.value)
  )
  return settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value as string] : []
  )
}

/**
 * bigmi observers (`waitForTransaction`, `watchBlockNumber`) that still have
 * a listener. A finished wait leaves none.
 */
export const liveBigmiObservers = (): string[] =>
  [...listenersCache.entries()]
    .filter(([, listeners]) => listeners.length > 0)
    .map(([id]) => id)

/**
 * Stops every bigmi block poll and drops every observer, so a failed
 * spec cannot send block polls during the next one.
 */
export const clearBigmiObservers = (): void => {
  for (const cleanup of cleanupCache.values()) {
    cleanup()
  }
  cleanupCache.clear()
  listenersCache.clear()
}

/**
 * Advances fake time in 1 s steps until `promise` settles (at most
 * `maxMs`), then returns its result. For paths where bigmi sleeps before it
 * reads (the 3 s `getrawtransaction` retries of a replaced transaction).
 */
export const settleWithFakeTime = async <T>(
  promise: Promise<T>,
  maxMs = 300_000
): Promise<T> => {
  let settled = false
  const tracked = promise.finally(() => {
    settled = true
  })
  tracked.catch(() => {})
  for (let elapsed = 0; !settled && elapsed < maxMs; elapsed += 1_000) {
    await vi.advanceTimersByTimeAsync(1_000)
  }
  if (!settled) {
    throw new Error(`Still running after ${maxMs} ms of fake time`)
  }
  return tracked
}

// ---------------------------------------------------------------------------
// Route updates as the widget sees them
// ---------------------------------------------------------------------------

export interface RouteUpdates {
  /** Pass as `updateRouteHook`. */
  readonly hook: (route: RouteExtended) => void
  /** A JSON copy of the route at every hook call (what storage holds). */
  readonly snapshots: RouteExtended[]
  /**
   * `${action type}:${status}` each time an action appears or changes its
   * status between two hook calls, in order: the state changes a user sees.
   */
  readonly changes: string[]
}

export const recordRouteUpdates = (): RouteUpdates => {
  let previous = new Map<string, string>()
  const updates: RouteUpdates = {
    snapshots: [],
    changes: [],
    hook: (route) => {
      const snapshot = JSON.parse(JSON.stringify(route)) as RouteExtended
      updates.snapshots.push(snapshot)
      const current = new Map<string, string>()
      for (const step of snapshot.steps) {
        for (const action of step.execution?.actions ?? []) {
          current.set(action.type, action.status)
          if (previous.get(action.type) !== action.status) {
            updates.changes.push(`${action.type}:${action.status}`)
          }
        }
      }
      previous = current
    },
  }
  return updates
}

/** The step of a one-step route. */
export const stepOf = (route: RouteExtended): LiFiStepExtended => route.steps[0]
