type Options = Parameters<typeof fetch>[1] & {
  headers?: Record<string, string>
  apiKey?: string
  method?: 'GET' | 'POST'
  onError?: (error: any) => any
  responseHandler?: (response: any) => any
  searchParams?: Record<string, string>
  json?: unknown
}

let clientConfig: Options = {}

export const defaultRequestHeaders =
  typeof window !== 'undefined'
    ? ({} as Record<string, string>)
    : {
        referrer: 'https://sk.thorswap.net',
        referer: 'https://sk.thorswap.net',
      }

export function setRequestClientConfig({ apiKey, ...config }: Options) {
  clientConfig = { ...config, apiKey }
}

async function fetchWithConfig(url: string, options: Options) {
  const { apiKey, ...config } = clientConfig
  const { searchParams, json, body } = options
  const headers = {
    ...defaultRequestHeaders,
    ...config.headers,
    ...options.headers,
  } as Record<string, string>

  const bodyToSend = json ? JSON.stringify(json) : body

  const urlInstance = new URL(url)
  if (searchParams) {
    urlInstance.search = new URLSearchParams(searchParams).toString()
  }

  if (apiKey) {
    headers['x-api-key'] = apiKey
  }

  try {
    const response = await fetch(urlInstance.toString(), {
      ...config,
      ...options,
      body: bodyToSend,
      headers,
    })
    const body = await response.json()

    if (options.responseHandler) {
      return options.responseHandler(body)
    }

    return body
  } catch (error) {
    if (options.onError) {
      return options.onError(error)
    }

    console.error(error)
  }
}

export const RequestClient = {
  get: async <T>(url: string, options?: Options): Promise<T> =>
    fetchWithConfig(url, { ...options, method: 'GET' }),
  post: async <T>(url: string, options?: Options): Promise<T> =>
    fetchWithConfig(url, { ...options, method: 'POST' }),
  extend: (options: Options) => {
    const extendedConfig = { ...clientConfig, ...options }
    return {
      get: async <T>(url: string, options?: Options): Promise<T> =>
        fetchWithConfig(url, { ...extendedConfig, ...options, method: 'GET' }),
      post: async <T>(url: string, options?: Options): Promise<T> =>
        fetchWithConfig(url, { ...extendedConfig, ...options, method: 'POST' }),
      extend: (newOptions: Options) =>
        RequestClient.extend({ ...extendedConfig, ...newOptions }),
    }
  },
}
