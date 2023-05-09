/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Signer } from 'ethers'
import { Route } from '../types'
import { LifiErrorCode } from './errors'

export const handlePreRestart = async (route: Route, signer: Signer) => {
  for (let index = 0; index < route.steps.length; index++) {
    const stepHasFailed = route.steps[index].execution?.status === 'FAILED'

    if (stepHasFailed) {
      await handleErrorType(route, index, signer)
      deleteFailedProcesses(route, index)
      deleteTransactionData(route, index)
    }
  }
}

const handleErrorType = async (route: Route, index: number, signer: Signer) => {
  const isGasLimitError = route.steps[index].execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.GasLimitError
  )
  const isGasPriceError = route.steps[index].execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.TransactionUnderpriced
  )

  const { transactionRequest } = route.steps[index]

  if (isGasLimitError) {
    if (transactionRequest) {
      let gasLimit = transactionRequest.gasLimit

      try {
        gasLimit = await signer.estimateGas(transactionRequest)
      } catch (error) {
        console.log(error)
      }

      transactionRequest.gasLimit = `${Math.round(Number(gasLimit) * 1.25)}`
    }

    route.steps[index].estimate.gasCosts?.forEach(
      (gasCost) =>
        (gasCost.limit = `${Math.round(Number(gasCost.limit) * 1.25)}`)
    )
  }

  if (isGasPriceError) {
    route.steps[index].estimate.gasCosts?.forEach(
      (gasCost) =>
        (gasCost.price = `${Math.round(Number(gasCost.price) * 1.25)}`)
    )
  }
}

const deleteFailedProcesses = (route: Route, index: number) => {
  if (route.steps[index].execution) {
    route.steps[index].execution!.process = route.steps[
      index
    ].execution!.process.filter((process) => process.status === 'DONE')
  }
}

const deleteTransactionData = (route: Route, index: number) => {
  route.steps[index].transactionRequest = undefined
}
