import type { UnavailableRoutes } from '@lifi/types'
import type { ExtendedRequestInit } from '../types/request.js'
import { BaseError } from './baseError.js'
import { ErrorMessage, ErrorName, LiFiErrorCode } from './constants.js'

interface ServerErrorResponseBody {
  code: number
  message: string
  errors?: UnavailableRoutes
}

const statusCodeToErrorClassificationMap = new Map([
  [
    400,
    { type: ErrorName.ValidationError, code: LiFiErrorCode.ValidationError },
  ],
  [404, { type: ErrorName.NotFoundError, code: LiFiErrorCode.NotFound }],
  [
    409,
    {
      type: ErrorName.SlippageError,
      code: LiFiErrorCode.SlippageError,
      message: ErrorMessage.SlippageError,
    },
  ],
  [424, { type: ErrorName.ServerError, code: LiFiErrorCode.ThirdPartyError }],
  [429, { type: ErrorName.ServerError, code: LiFiErrorCode.RateLimitExceeded }],
  [500, { type: ErrorName.ServerError, code: LiFiErrorCode.InternalError }],
])

const getErrorClassificationFromStatusCode = (code: number) =>
  statusCodeToErrorClassificationMap.get(code) ?? {
    type: ErrorName.ServerError,
    code: LiFiErrorCode.InternalError,
  }

const createInitialMessage = (response: Response) => {
  const statusCode =
    response.status || response.status === 0 ? response.status : ''
  const title = response.statusText || ''
  const status = `${statusCode} ${title}`.trim()
  const reason = status ? `status code ${status}` : 'an unknown error'
  return `Request failed with ${reason}`
}

export class HTTPError extends BaseError {
  public response: Response
  public status: number
  public url: RequestInfo | URL
  public fetchOptions: ExtendedRequestInit
  public type?: ErrorName
  public responseBody?: ServerErrorResponseBody

  constructor(
    response: Response,
    url: RequestInfo | URL,
    options: ExtendedRequestInit
  ) {
    const errorClassification = getErrorClassificationFromStatusCode(
      response.status
    )
    const additionalMessage = errorClassification?.message
      ? `\n${errorClassification.message}`
      : ''
    const message = createInitialMessage(response) + additionalMessage

    super(ErrorName.HTTPError, errorClassification.code, message)

    this.type = errorClassification.type
    this.response = response
    this.status = response.status
    this.message = message
    this.url = url
    this.fetchOptions = options
  }

  async buildAdditionalDetails() {
    if (this.type) {
      this.message = `[${this.type}] ${this.message}`
    }

    try {
      this.responseBody = await this.response.json()

      if (this.responseBody) {
        this.message += this.message.endsWith('.')
          ? ` ${this.responseBody?.message.toString()}`
          : `. ${this.responseBody?.message.toString()}`
      }
    } catch {}

    return this
  }
}
