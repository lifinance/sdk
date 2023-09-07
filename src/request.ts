import { ConfigService } from './services/ConfigService.js'
import { HTTPError } from './utils/errors.js'
import { wait } from './utils/utils.js'
import { version } from './version.js'

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
          'x-lifi-api-key': apiKey,
        }
      }

      if (userId) {
        options.headers = {
          ...options?.headers,
          'x-lifi-userid': userId,
        }
      }

      if (widgetVersion) {
        options.headers = {
          ...options?.headers,
          'x-lifi-widget': widgetVersion,
        }
      }

      if (version) {
        options.headers = {
          ...options?.headers,
          'x-lifi-sdk': version,
        }
      }

      // integrator is mandatory during SDK initialization
      options.headers = {
        ...options?.headers,
        'x-lifi-integrator': integrator,
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
      await wait(500)
      return request<T>(url, { ...options, retries: options.retries - 1 })
    }
    throw error
  }
}
