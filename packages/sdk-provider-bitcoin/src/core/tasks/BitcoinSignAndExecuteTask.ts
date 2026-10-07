import {
  AddressType,
  getAddressInfo,
  hexToUnit8Array,
  signPsbt,
  withTimeout,
} from '@bigmi/core'
import * as ecc from '@bitcoinerlab/secp256k1'
import {
  assertNoOpenTransaction,
  BaseStepExecutionTask,
  CLEARED_TRANSACTION_FIELDS,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { address, initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import type {
  BitcoinStepExecutorContext,
  BitcoinTaskContext,
} from '../../types.js'
import { generateRedeemScript } from '../../utils/generateRedeemScript.js'
import { isPsbtFinalized } from '../../utils/isPsbtFinalized.js'
import { toXOnly } from '../../utils/toXOnly.js'
import {
  classifyBitcoinSendFailure,
  lookUpBitcoinTransaction,
} from './classifyBitcoinSendFailure.js'

export class BitcoinSignAndExecuteTask extends BaseStepExecutionTask {
  async run(context: BitcoinStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      walletClient,
      statusManager,
      executionOptions,
      fromChain,
      publicClient,
      checkClient,
      isBridgeExecution,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    // Defence in depth: the selector never routes an open transaction here,
    // and signing again could spend the same funds twice.
    assertNoOpenTransaction(action)

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    checkClient(step)

    const psbtHex = transactionRequestData

    // Initialize ECC library required for Taproot operations
    // https://github.com/bitcoinjs/bitcoinjs-lib?tab=readme-ov-file#using-taproot
    initEccLib(ecc)

    const psbt = Psbt.fromHex(psbtHex, { network: networks.bitcoin })

    psbt.data.inputs.forEach((input, index) => {
      const accountAddress = input.witnessUtxo
        ? address.fromOutputScript(input.witnessUtxo.script, networks.bitcoin)
        : (walletClient.account?.address as string)
      const addressInfo = getAddressInfo(accountAddress)
      if (addressInfo.type === AddressType.p2tr) {
        // Taproot (P2TR) addresses require specific PSBT fields for proper signing

        // tapInternalKey: Required for Taproot key-path spending
        // Most wallets  / libraries usually handle this already
        if (!input.tapInternalKey) {
          const pubKey = walletClient.account?.publicKey
          if (pubKey) {
            const tapInternalKey = toXOnly(hexToUnit8Array(pubKey))
            psbt.updateInput(index, {
              tapInternalKey,
            })
          }
        }
        // sighashType: Required by bitcoinjs-lib even though the bitcoin protocol allows defaults
        // check if sighashType is default (0) or not set (undefined)
        if (!input.sighashType) {
          psbt.updateInput(index, {
            sighashType: 1, // Default to Transaction.SIGHASH_ALL - 1
          })
        }
      }
      // redeemScript: Required by Pay-to-Script-Hash (P2SH) addresses for proper spending
      if (addressInfo.type === AddressType.p2sh) {
        if (!input.redeemScript) {
          const pubKey = walletClient.account?.publicKey
          if (pubKey) {
            psbt.updateInput(index, {
              redeemScript: generateRedeemScript(hexToUnit8Array(pubKey)),
            })
          }
        }
      }
    })

    const inputsToSign = Array.from(
      psbt.data.inputs
        .reduce((map, input, index) => {
          const accountAddress = input.witnessUtxo
            ? address.fromOutputScript(
                input.witnessUtxo.script,
                networks.bitcoin
              )
            : (walletClient.account?.address as string)
          if (map.has(accountAddress)) {
            map.get(accountAddress)!.signingIndexes.push(index)
          } else {
            map.set(accountAddress, {
              address: accountAddress,
              sigHash: 1, // Default to Transaction.SIGHASH_ALL - 1
              signingIndexes: [index],
            })
          }
          return map
        }, new Map<
          string,
          { address: string; sigHash: number; signingIndexes: number[] }
        >())
        .values()
    )

    // Checked again right before the wallet: a late write of an older run
    // can merge its transaction into this action during the awaits above.
    assertNoOpenTransaction(statusManager.findAction(step, action.type))

    // We give users 10 minutes to sign the transaction or it should be considered expired
    const signedPsbtHex = await withTimeout(
      () =>
        signPsbt(walletClient, {
          psbt: psbt.toHex(),
          inputsToSign: inputsToSign,
          finalize: false,
        }),
      {
        timeout: 600_000,
        errorInstance: new TransactionError(
          LiFiErrorCode.TransactionExpired,
          'Transaction has expired.'
        ),
      }
    )

    // Checked once more after the wallet: a stopped run's late write can
    // merge its transaction into this action while the prompt is open.
    // Nothing awaits from here to the write below.
    assertNoOpenTransaction(statusManager.findAction(step, action.type))

    const signedPsbt = Psbt.fromHex(signedPsbtHex)

    if (!isPsbtFinalized(signedPsbt)) {
      signedPsbt.finalizeAllInputs()
    }

    const transaction = signedPsbt.extractTransaction()
    const txHex = transaction.toHex()
    const txHash = transaction.getId()
    const txLinkOf = (txid: string): string =>
      `${fromChain.metamask.blockExplorerUrls[0]}tx/${txid}`

    // Written before the send: a reload during the send finds the bytes and
    // resumes at the wait task instead of signing a second transaction.
    statusManager.updateAction(step, action.type, 'PENDING', {
      // A new transaction: nothing of the previous one may survive, least of
      // all its `txFinal` verdict.
      ...CLEARED_TRANSACTION_FIELDS,
      txHash,
      txLink: txLinkOf(txHash),
      txHex,
      signedAt: Date.now(),
    })

    try {
      // One round: bigmi's fallback retries a failed round up to 3 times, and
      // its error keeps only the last round. A node of an earlier round may
      // have accepted the bytes.
      const sentTxHash: unknown = await publicClient.request(
        { method: 'sendrawtransaction', params: [txHex] },
        { retryCount: 0 }
      )
      // A node answers with the txid of the bytes it got. Without a txid,
      // `getId()` stays; a different txid is not expected.
      if (
        typeof sentTxHash === 'string' &&
        sentTxHash !== '' &&
        sentTxHash !== txHash
      ) {
        statusManager.updateAction(step, action.type, 'PENDING', {
          txHash: sentTxHash,
          txLink: txLinkOf(sentTxHash),
        })
      }
    } catch (error) {
      const failure = classifyBitcoinSendFailure(error)
      if (failure === 'unknown') {
        // An earlier URL may have accepted the bytes. Keep them: "Try again"
        // resumes at the wait task, which resends them within the age cap.
        throw error
      }
      if (failure === 'refused') {
        const lookup = await lookUpBitcoinTransaction(publicClient, txHash)
        if (lookup === 'absent') {
          // Every URL refused these bytes for a reason that names no other
          // transaction, and no node holds them. They are dropped here, so
          // they can never land: "Try again" signs a new transaction.
          statusManager.updateAction(step, action.type, 'PENDING', {
            ...CLEARED_TRANSACTION_FIELDS,
          })
          throw error
        }
        if (lookup === 'unknown') {
          throw error
        }
      }
      // A node already holds the transaction.
    }

    return {
      status: 'COMPLETED',
      context: { bitcoinSent: true } satisfies BitcoinTaskContext,
    }
  }
}
