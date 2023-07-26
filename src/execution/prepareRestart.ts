import { publicActions, type WalletClient } from 'viem'
import type { LifiStep, Route } from '../types'
import { LifiErrorCode } from '../utils/errors'

export const prepareRestart = async (
  route: Route,
  walletClient: WalletClient
) => {
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index]
    const stepHasFailed = step.execution?.status === 'FAILED'

    if (stepHasFailed) {
      await handleErrorType(walletClient, step)
      deleteFailedProcesses(step)
      deleteTransactionData(step)
    }
  }
}

const handleErrorType = async (walletClient: WalletClient, step: LifiStep) => {
  const client = walletClient.extend(publicActions)

  const isGasLimitError = step.execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.GasLimitError
  )
  const isGasPriceError = step.execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.TransactionUnderpriced
  )

  const { transactionRequest } = step

  // if (isGasLimitError) {
  //   if (transactionRequest) {
  //     let gasLimit = transactionRequest.gasLimit

  //     try {
  //       gasLimit = await client.estimateGas(transactionRequest)
  //     } catch (error) {}

  //     if (gasLimit) {
  //       transactionRequest.gasLimit = BigNumber.from(
  //         `${(BigInt(gasLimit.toString()) * 125n) / 100n}`
  //       )
  //     }
  //   }

  //   step.estimate.gasCosts?.forEach(
  //     (gasCost) =>
  //       (gasCost.limit = `${Math.round(Number(gasCost.limit) * 1.25)}`)
  //   )
  // }

  // if (isGasPriceError) {
  //   if (transactionRequest) {
  //     let gasPrice = transactionRequest.gasPrice

  //     try {
  //       gasPrice = await client.getGasPrice()
  //     } catch (error) {}

  //     if (gasPrice) {
  //       transactionRequest.gasPrice = BigNumber.from(
  //         `${(BigInt(gasPrice.toString()) * 125n) / 100n}`
  //       )
  //     }
  //   }

  //   step.estimate.gasCosts?.forEach(
  //     (gasCost) =>
  //       (gasCost.price = `${Math.round(Number(gasCost.price) * 1.25)}`)
  //   )
  // }
}

const deleteFailedProcesses = (step: LifiStep) => {
  if (step.execution) {
    step.execution.process = step.execution.process.filter(
      (process) => process.status === 'DONE'
    )
  }
}

const deleteTransactionData = (step: LifiStep) => {
  step.transactionRequest = undefined
}
