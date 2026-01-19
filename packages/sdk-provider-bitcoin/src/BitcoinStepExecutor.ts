import type { Client, ReplacementReason } from '@bigmi/core'
import {
  AddressType,
  getAddressInfo,
  hexToUnit8Array,
  signPsbt,
  waitForTransaction,
  withTimeout,
} from '@bigmi/core'
import * as ecc from '@bitcoinerlab/secp256k1'
import {
  BaseStepExecutor,
  ChainId,
  checkBalance,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  type SDKClient,
  type StepExecutorOptions,
  stepComparison,
  TransactionError,
  type TransactionParameters,
  waitForDestinationChainTransaction,
} from '@lifi/sdk'
import { address, initEccLib, networks, Psbt } from 'bitcoinjs-lib'
import { getBitcoinPublicClient } from './client/publicClient.js'
import { parseBitcoinErrors } from './errors/parseBitcoinErrors.js'
import { generateRedeemScript } from './utils/generateRedeemScript.js'
import { isPsbtFinalized } from './utils/isPsbtFinalized.js'
import { toXOnly } from './utils/toXOnly.js'

interface BitcoinStepExecutorOptions extends StepExecutorOptions {
  client: Client
}

export class BitcoinStepExecutor extends BaseStepExecutor {
  private client: Client

  constructor(options: BitcoinStepExecutorOptions) {
    super(options)
    this.client = options.client
  }

  checkClient = (step: LiFiStepExtended) => {
    // TODO: check chain and possibly implement chain switch?
    // Prevent execution of the quote by wallet different from the one which requested the quote
    if (this.client.account?.address !== step.action.fromAddress) {
      throw new TransactionError(
        LiFiErrorCode.WalletChangedDuringExecution,
        'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
      )
    }
  }

  executeStep = async (
    client: SDKClient,
    step: LiFiStepExtended
  ): Promise<LiFiStepExtended> => {
    const fromChain = await client.getChainById(step.action.fromChainId)
    const toChain = await client.getChainById(step.action.toChainId)

    const isBridgeExecution = fromChain.id !== toChain.id
    const currentProcessType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'

    step = this.statusManager.updateExecution(step, {
      type: currentProcessType,
      status: 'PENDING',
      chainId: fromChain.id,
    })

    const publicClient = await getBitcoinPublicClient(client, ChainId.BTC)

    if (step.execution?.status !== 'DONE') {
      try {
        let txHash: string
        let txHex: string
        const currentTransaction = step.execution?.transactions.find(
          (t) => t.type === currentProcessType
        )
        if (currentTransaction?.txHash) {
          // Make sure that the chain is still correct
          this.checkClient(step)

          // Wait for exiting transaction
          txHash = currentTransaction.txHash
          txHex = currentTransaction.txHex ?? ''
        } else {
          step = this.statusManager.updateExecution(step, { status: 'STARTED' })

          // Check balance
          await checkBalance(client, this.client.account!.address, step)

          // Create new transaction
          if (!step.transactionRequest) {
            const { execution, ...stepBase } = step
            const updatedStep = await getStepTransaction(client, stepBase)
            const comparedStep = await stepComparison(
              this.statusManager,
              step,
              updatedStep,
              this.allowUserInteraction,
              this.executionOptions
            )
            Object.assign(step, {
              ...comparedStep,
              execution: step.execution,
            })
          }

          if (!step.transactionRequest?.data) {
            throw new TransactionError(
              LiFiErrorCode.TransactionUnprepared,
              'Unable to prepare transaction.'
            )
          }

          step = this.statusManager.updateExecution(step, {
            status: 'ACTION_REQUIRED',
          })

          if (!this.allowUserInteraction) {
            return step
          }

          let transactionRequest: TransactionParameters = {
            data: step.transactionRequest?.data,
          }

          if (this.executionOptions?.updateTransactionRequestHook) {
            const customizedTransactionRequest: TransactionParameters =
              await this.executionOptions.updateTransactionRequestHook({
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

          this.checkClient(step)

          const psbtHex = transactionRequest.data

          // Initialize ECC library required for Taproot operations
          // https://github.com/bitcoinjs/bitcoinjs-lib?tab=readme-ov-file#using-taproot
          initEccLib(ecc)

          const psbt = Psbt.fromHex(psbtHex, { network: networks.bitcoin })

          psbt.data.inputs.forEach((input, index) => {
            const accountAddress = input.witnessUtxo
              ? address.fromOutputScript(
                  input.witnessUtxo.script,
                  networks.bitcoin
                )
              : (this.client.account?.address as string)
            const addressInfo = getAddressInfo(accountAddress)
            if (addressInfo.type === AddressType.p2tr) {
              // Taproot (P2TR) addresses require specific PSBT fields for proper signing

              // tapInternalKey: Required for Taproot key-path spending
              // Most wallets  / libraries usually handle this already
              if (!input.tapInternalKey) {
                const pubKey = this.client.account?.publicKey
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
                const pubKey = this.client.account?.publicKey
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
                  : (this.client.account?.address as string)
                if (map.has(accountAddress)) {
                  map.get(accountAddress).signingIndexes.push(index)
                } else {
                  map.set(accountAddress, {
                    address: accountAddress,
                    sigHash: 1, // Default to Transaction.SIGHASH_ALL - 1
                    signingIndexes: [index],
                  })
                }
                return map
              }, new Map())
              .values()
          )

          // We give users 10 minutes to sign the transaction or it should be considered expired
          const signedPsbtHex = await withTimeout(
            () =>
              signPsbt(this.client, {
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

          txHex = signedPsbt.extractTransaction().toHex()

          txHash = await publicClient.sendUTXOTransaction({
            hex: txHex,
          })

          step = this.statusManager.updateExecution(step, {
            status: 'PENDING',
            transaction: {
              txHash: txHash,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${txHash}`,
              txHex,
            },
          })
        }

        let replacementReason: ReplacementReason | undefined
        const transaction = await waitForTransaction(publicClient, {
          txId: txHash,
          txHex,
          senderAddress: this.client.account?.address,
          onReplaced: (response) => {
            replacementReason = response.reason
            step = this.statusManager.updateExecution(step, {
              status: 'PENDING',
              transaction: {
                txHash: response.transaction.txid,
                txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${response.transaction.txid}`,
              },
            })
          },
        })

        if (replacementReason === 'cancelled') {
          throw new TransactionError(
            LiFiErrorCode.TransactionCanceled,
            'User canceled transaction.'
          )
        }

        if (transaction.txid !== txHash) {
          step = this.statusManager.updateExecution(step, {
            status: 'PENDING',
            transaction: {
              txHash: transaction.txid,
              txLink: `${fromChain.metamask.blockExplorerUrls[0]}tx/${transaction.txid}`,
            },
          })
        }

        if (isBridgeExecution) {
          step = this.statusManager.updateExecution(step, { status: 'DONE' })
        }
      } catch (e: any) {
        const error = await parseBitcoinErrors(e, step)
        step = this.statusManager.updateExecution(step, {
          status: 'FAILED',
          error: {
            message: error.cause.message,
            code: error.code,
          },
        })
        throw error
      }
    }

    await waitForDestinationChainTransaction(
      client,
      step,
      fromChain,
      toChain,
      this.statusManager,
      10_000
    )

    // DONE
    return step
  }
}
