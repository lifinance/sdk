import {
  AddressType,
  getAddressInfo,
  hexToUnit8Array,
  signPsbt,
  withTimeout,
} from '@bigmi/core'
import * as ecc from '@bitcoinerlab/secp256k1'
import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { address, initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import { generateRedeemScript } from '../utils/generateRedeemScript.js'
import { isPsbtFinalized } from '../utils/isPsbtFinalized.js'
import { toXOnly } from '../utils/toXOnly.js'
import type { BitcoinTaskExtra } from './types.js'

export interface BitcoinSignAndExecuteResult {
  txHex: string
}

export class BitcoinSignAndExecuteTask extends BaseStepExecutionTask<BitcoinTaskExtra> {
  readonly type = 'BITCOIN_SIGN_AND_EXECUTE'

  override async shouldRun(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<boolean> {
    return !context.isTransactionExecuted()
  }

  protected override async run(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<BitcoinSignAndExecuteResult>> {
    const actionType = context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    context.getOrCreateAction(actionType)
    const { step, walletClient, statusManager, executionOptions } = context

    if (walletClient.account?.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

    if (!step.transactionRequest?.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    let transactionRequest: TransactionParameters = {
      data: step.transactionRequest.data,
    }

    if (executionOptions?.updateTransactionRequestHook) {
      const customizedTransactionRequest: TransactionParameters =
        await executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })
      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    if (!transactionRequest.data) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

    const psbtHex = transactionRequest.data

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
        if (!input.tapInternalKey) {
          const pubKey = walletClient.account?.publicKey
          if (pubKey) {
            const tapInternalKey = toXOnly(hexToUnit8Array(pubKey))
            psbt.updateInput(index, {
              tapInternalKey,
            })
          }
        }
        if (!input.sighashType) {
          psbt.updateInput(index, {
            sighashType: 1, // Default to Transaction.SIGHASH_ALL - 1
          })
        }
      }
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
              sigHash: 1,
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

    const signedPsbt = Psbt.fromHex(signedPsbtHex)

    if (!isPsbtFinalized(signedPsbt)) {
      signedPsbt.finalizeAllInputs()
    }

    const txHex = signedPsbt.extractTransaction().toHex()

    statusManager.updateAction(step, actionType, 'PENDING')

    return {
      status: 'COMPLETED',
      data: { txHex },
    }
  }
}
