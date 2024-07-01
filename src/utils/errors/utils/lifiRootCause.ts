import { LiFiBaseError } from '../baseError.js'
import { HTTPError } from '../httpError.js'

export const getLiFiRootCause = (e: Error) => {
  let rootCause = e
  while (rootCause.cause && rootCause.cause instanceof LiFiBaseError) {
    rootCause = rootCause.cause as LiFiBaseError
  }
  return rootCause as LiFiBaseError
}

export const getLiFiRootCauseMessage = (e: Error) => {
  const rootCause = getLiFiRootCause(e)

  return rootCause instanceof HTTPError
    ? (rootCause as HTTPError).responseBody?.message || rootCause.message
    : rootCause.message
}
