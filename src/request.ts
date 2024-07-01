import { config } from './config.js'
import { HTTPError } from './utils/errors/httpError.js'
import { wait } from './utils/utils.js'
import { getApiValidationError } from './utils/errors/create.js'
import { LiFiSDKError } from './utils/errors/SDKError.js'
import type { ExtendedRequestInit } from './types/request.js'
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
  const { userId, integrator, widgetVersion, apiKey } = config.get()

  if (!integrator) {
    throw getApiValidationError(
      'You need to provide the Integrator property. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
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

    const response: Response = await fetch(
      url,
      stripExtendRequestInitProperties(options)
    )

    if (!response.ok) {
      throw new HTTPError(response, url, options)
    }

    return await response.json()
  } catch (error) {
    if (options.retries > 0 && (error as HTTPError).status === 500) {
      await wait(500)
      return request<T>(url, { ...options, retries: options.retries - 1 })
    }

    await (error as HTTPError).buildAdditionalDetails?.()

    throw new LiFiSDKError(error as HTTPError)
  }
}
