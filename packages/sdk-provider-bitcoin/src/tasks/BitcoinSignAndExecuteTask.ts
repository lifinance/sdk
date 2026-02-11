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
  type ExecutionAction,
  getTransactionRequestData,
  LiFiErrorCode,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import { address, initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import type { BitcoinStepExecutorContext } from '../types.js'
import { generateRedeemScript } from '../utils/generateRedeemScript.js'
import { isPsbtFinalized } from '../utils/isPsbtFinalized.js'
import { toXOnly } from '../utils/toXOnly.js'

export class BitcoinSignAndExecuteTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: BitcoinStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: BitcoinStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const {
      step,
      walletClient,
      statusManager,
      executionOptions,
      fromChain,
      publicClient,
    } = context

    const transactionRequestData = await getTransactionRequestData(
      step,
      executionOptions
    )

    // TODO: check chain and possibly implement chain switch?
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (walletClient.account?.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }

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

    const signedPsbt = Psbt.fromHex(signedPsbtHex)

    if (!isPsbtFinalized(signedPsbt)) {
      signedPsbt.finalizeAllInputs()
    }

    const txHex = signedPsbt.extractTransaction().toHex()

    const txHash = await publicClient.sendUTXOTransaction({
      hex: txHex,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      txHash: txHash,
      txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
      txHex,
      signedAt: Date.now(),
    })

    return {
      status: 'COMPLETED',
      data: {
        txHex,
        txHash,
      },
    }
  }
}
