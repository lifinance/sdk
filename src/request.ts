import ConfigService from './services/ConfigService'
import { HTTPError } from './utils/errors'
import { sleep } from './utils/utils'
import { version } from './version'

export const requestSettings = {
  retries: 1,
}

interface ExtendedRequestInit extends RequestInit {
  retries?: number
  skipTrackingHeaders?: boolean
}

export const request = async <T = Response>(
  url: RequestInfo | URL,
  options: ExtendedRequestInit = {
    retries: requestSettings.retries,
  }
): Promise<T> => {
  const { userId, integrator, widgetVersion, apiKey } =
    ConfigService.getInstance().getConfig()

  options.retries = options.retries ?? requestSettings.retries
  try {
    if (!options.skipTrackingHeaders) {
      if (apiKey) {
        options.headers = {
          ...options?.headers,
          'X-LIFI-api-key': apiKey,
        }
      }

      if (userId) {
        options.headers = {
          ...options?.headers,
          'X-LIFI-UserId': userId,
        }
      }

      if (widgetVersion) {
        options.headers = {
          ...options?.headers,
          'X-LIFI-Widget': widgetVersion,
        }
      }

      if (version) {
        options.headers = {
          ...options?.headers,
          'X-LIFI-SDK': version,
        }
      }

      // integrator is mandatory during SDK initialization
      options.headers = {
        ...options?.headers,
        'X-LIFI-Integrator': integrator,
      }
    }

    const response: Response = await fetch(url, options)
    if (!response.ok) {
      throw new HTTPError(response)
    }

    const data: T = await response.json()
    return data
  } catch (error) {
    if (options.retries > 0 && (error as HTTPError)?.status === 500) {
      await sleep(500)
      return request<T>(url, { ...options, retries: options.retries - 1 })
    }
    throw error
  }
}
