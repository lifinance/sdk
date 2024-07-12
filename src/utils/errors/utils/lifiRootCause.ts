import { BaseError } from '../baseError.js'
import { HTTPError } from '../httpError.js'

export const getLiFiRootCause = (e: Error) => {
  let rootCause = e
  while (rootCause.cause && rootCause.cause instanceof BaseError) {
    rootCause = rootCause.cause as BaseError
  }
  return rootCause as BaseError
}

export const getLiFiRootCauseMessage = (e: Error) => {
  const rootCause = getLiFiRootCause(e)

  return rootCause instanceof HTTPError
    ? (rootCause as HTTPError).responseBody?.message || rootCause.message
    : rootCause.message
}
