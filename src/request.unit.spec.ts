import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  type Mock,
} from 'vitest'
import { config } from './config.js'
import type { SDKBaseConfig } from './types/index.js'
import { request } from './request.js'
import { SDKError } from './utils/errors/SDKError.js'
import { type HTTPError, ValidationError } from './utils/index.js'
import type { ExtendedRequestInit } from './types/request.js'
import { version } from './version.js'

const mockUrl = 'https://some.endpoint.com'
const mockSuccessMessage = { message: 'it worked!' }

const setUpMocks = (
  mockConfig: SDKBaseConfig = {
    userId: 'user-id',
    integrator: 'mock-integrator',
    widgetVersion: 'mock-widget-version',
    apiKey: 'mock-apikey',
  } as SDKBaseConfig,
  mockResponse: Response = {
    ok: true,
    status: 200,
    statusText: 'Success',
    json: () => Promise.resolve(mockSuccessMessage),
  } as Response
) => {
  ;(global.fetch as Mock).mockResolvedValue(mockResponse)

  vi.spyOn(config, 'get').mockReturnValue(mockConfig)
}

describe('request', () => {
  beforeAll(() => {
    vi.spyOn(global, 'fetch')
  })

  beforeEach(() => {
    ;(global.fetch as Mock).mockReset()
  })

  afterAll(() => {
    vi.clearAllMocks()
  })

  it('should be able to successfully make a fetch request', async () => {
    setUpMocks()

    const response = await request<{ message: string }>(mockUrl)

    expect(response).toEqual(mockSuccessMessage)
  })

  it('should remove the extended request init properties that fetch does not care about', async () => {
    setUpMocks()

    const options: ExtendedRequestInit = {
      retries: 0,
      headers: {
        'x-lifi-api-key': 'mock-apikey',
        'x-lifi-integrator': 'mock-integrator',
        'x-lifi-sdk': '3.0.0-beta.0',
        'x-lifi-userid': 'user-id',
        'x-lifi-widget': 'mock-widget-version',
      },
    }

    const response = await request<{ message: string }>(mockUrl, options)

    expect(response).toEqual(mockSuccessMessage)

    const fetchOptions = (global.fetch as Mock).mock.calls[0][1]

    expect(fetchOptions).toEqual({
      headers: {
        'x-lifi-api-key': 'mock-apikey',
        'x-lifi-integrator': 'mock-integrator',
        'x-lifi-sdk': version,
        'x-lifi-userid': 'user-id',
        'x-lifi-widget': 'mock-widget-version',
      },
    })
  })

  it('should update the headers information available from config', async () => {
    setUpMocks()

    await request<{ message: string }>('https://some.endpoint.com')

    const url = (global.fetch as Mock).mock.calls[0][0]
    const headers = (global.fetch as Mock).mock.calls[0][1].headers

    expect(url).toEqual(mockUrl)

    expect(headers['x-lifi-api-key']).toEqual('mock-apikey')
    expect(headers['x-lifi-integrator']).toEqual('mock-integrator')
    expect(headers['x-lifi-sdk']).toBeDefined()
    expect(headers['x-lifi-userid']).toEqual('user-id')
    expect(headers['x-lifi-widget']).toEqual('mock-widget-version')
  })

  describe('when dealing with errors', () => {
    it('should throw an error if the Integrator property is missing from the config', async () => {
      const mockConfig = {
        userId: 'user-id',
        widgetVersion: 'mock-widget-version',
        apiKey: 'mock-apikey',
      } as SDKBaseConfig
      setUpMocks(mockConfig)

      await expect(
        request<{ message: string }>('https://some.endpoint.com')
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError(
            'You need to provide the Integrator property. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
          )
        )
      )
    })
    it('should throw a error with when the request fails', async () => {
      expect.assertions(2)

      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ message: 'it broke' }),
      } as Response
      setUpMocks(undefined, mockResponse)

      try {
        await request<{ message: string }>('https://some.endpoint.com')
      } catch (e) {
        expect((e as SDKError).name).toEqual('SDKError')
        expect(((e as SDKError).cause as HTTPError).status).toEqual(400)
      }
    })
    it('should throw a error and attempt retries when the request fails with a 500', async () => {
      expect.assertions(3)

      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'it broke' }),
      } as Response
      setUpMocks(undefined, mockResponse)

      try {
        await request<{ message: string }>('https://some.endpoint.com', {
          retries: 3,
        })
      } catch (e) {
        expect((e as SDKError).name).toEqual('SDKError')
        expect(((e as SDKError).cause as HTTPError).status).toEqual(500)
        expect(global.fetch as Mock).toBeCalledTimes(4)
      }
    })
  })
})
