/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Route } from '../types'
import { LifiErrorCode } from './errors'

export const handlePreRestart = (route: Route) => {
  for (let index = 0; index < route.steps.length; index++) {
    const stepHasFailed = route.steps[index].execution?.status === 'FAILED'

    if (stepHasFailed) {
      handleErrorType(route, index)
      deleteFailedProcesses(route, index)
    }
  }
}

const handleErrorType = (route: Route, index: number) => {
  const isGasLimitError = route.steps[index].execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.GasLimitError
  )
  const isGasPriceError = route.steps[index].execution?.process.some(
    (p) => p.error?.code === LifiErrorCode.TransactionUnderpriced
  )

  if (isGasLimitError) {
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
    ].execution!.process.filter((process) => process.status !== 'FAILED')
  }
}
