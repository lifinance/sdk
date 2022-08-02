import { Route } from '../types'
import { LifiErrorCode } from './errors'

export const handlePreRestart = (route: Route) => {
  for (let index = 0; index < route.steps.length; index++) {
    const stepHasFailed = route.steps[index].execution?.status === 'FAILED'

    if (stepHasFailed) {
      handleErrorType(route, index)
      popLastProcess(route, index)
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

const popLastProcess = (route: Route, index: number) => {
  route.steps[index].execution?.process.pop()
}
