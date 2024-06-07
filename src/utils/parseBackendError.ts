import { type LiFiError } from './errors.js'
import {
  ErrorMessage,
  NotFoundError,
  ServerError,
  SlippageError,
  ValidationError,
} from './errors.js'

export const parseBackendError = async (e: any): Promise<LiFiError> => {
  let data
  try {
    data = await e.response?.json()
  } catch (error) {
    // ignore
  }

  if (e.response?.status === 400) {
    return new ValidationError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  if (e.response?.status === 404) {
    return new NotFoundError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  if (e.response?.status === 409) {
    return new SlippageError(
      data?.message || e.response?.statusText,
      ErrorMessage.SlippageError,
      e.stack
    )
  }

  if (e.response?.status === 500) {
    return new ServerError(
      data?.message || e.response?.statusText,
      undefined,
      e.stack
    )
  }

  return new ServerError(ErrorMessage.Default, undefined, e.stack)
}
