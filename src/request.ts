import { config } from './config.js'
import { ValidationError } from './errors/errors.js'
import { HTTPError } from './errors/httpError.js'
import { SDKError } from './errors/SDKError.js'
import type { ExtendedRequestInit } from './types/request.js'
import { sleep } from './utils/sleep.js'
import { version } from './version.js'

export const requestSettings = {
  retries: 1,
}

const stripExtendRequestInitProperties = ({
  retries,
  ...rest
}: ExtendedRequestInit): RequestInit => ({
  ...rest,
})

export const request = async <T = Response>(
  url: RequestInfo | URL,
  options: ExtendedRequestInit = {
    retries: requestSettings.retries,
  }
): Promise<T> => {
  const { userId, integrator, widgetVersion, apiKey, requestInterceptor } =
    config.get()

  if (!integrator) {
    throw new SDKError(
      new ValidationError(
        'You need to provide the Integrator property. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
      )
    )
  }

  options.retries = options.retries ?? requestSettings.retries

  try {
    if (apiKey) {
      options.headers = {
        ...options.headers,
        'x-lifi-api-key': apiKey,
      }
    }

    if (userId) {
      options.headers = {
        ...options.headers,
        'x-lifi-userid': userId,
      }
    }

    if (widgetVersion) {
      options.headers = {
        ...options.headers,
        'x-lifi-widget': widgetVersion,
      }
    }

    if (version) {
      options.headers = {
        ...options.headers,
        'x-lifi-sdk': version,
      }
    }

    // integrator is mandatory during SDK initialization
    options.headers = {
      ...options.headers,
      'x-lifi-integrator': integrator,
    }

    if (requestInterceptor) {
      options = await requestInterceptor(options)
    }

    const response: Response = await fetch(
      url,
      stripExtendRequestInitProperties(options)
    )

    if (!response.ok) {
      throw new HTTPError(response, url, options)
    }

    return await response.json()
  } catch (error) {
    const retries = options.retries ?? 0
    if (retries > 0 && (error as HTTPError).status === 500) {
      await sleep(500)
      return request<T>(url, { ...options, retries: retries - 1 })
    }

    await (error as HTTPError).buildAdditionalDetails?.()

    throw new SDKError(error as HTTPError)
  }
}
