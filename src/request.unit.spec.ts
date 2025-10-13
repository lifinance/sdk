import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { handlers } from './actions/api.unit.handlers.js'
import { createClient } from './core/client/createClient.js'
import { ValidationError } from './errors/errors.js'
import type { HTTPError } from './errors/httpError.js'
import { SDKError } from './errors/SDKError.js'
import { request } from './request.js'
import type { ExtendedRequestInit } from './types/request.js'
import { version } from './version.js'

const client = createClient({
  integrator: 'lifi-sdk',
})
const config = client.config
const apiUrl = client.config.apiUrl

describe('request new', () => {
  const server = setupServer(...handlers)

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })

    vi.spyOn(global, 'fetch')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => server.resetHandlers())

  afterAll(() => {
    server.close()

    vi.clearAllMocks()
  })

  it('should be able to successfully make a fetch request', async () => {
    const url = `${apiUrl}/advanced/routes`

    const response = await request<{ message: string }>(config, url, {
      method: 'POST',
      retries: 0,
    })

    expect(response).toEqual({})
  })

  it('should remove the extended request init properties that fetch does not care about', async () => {
    const url = `${apiUrl}/advanced/routes`
    const successResponse = { message: 'it works' }

    server.use(
      http.post(url, async ({ request }) => {
        expect(request.headers.get('x-lifi-integrator')).toEqual('lifi-sdk')
        expect(request.headers.get('x-lifi-sdk')).toEqual(version)
        expect(request.headers.get('x-lifi-api-key')).toBeNull()
        expect(request.headers.get('x-lifi-userid')).toBeNull()
        expect(request.headers.get('x-lifi-widget')).toBeNull()

        return HttpResponse.json(successResponse, { status: 200 })
      })
    )

    const options: ExtendedRequestInit = {
      method: 'POST',
      retries: 0,
    }

    const response = await request<{ message: string }>(config, url, options)

    expect(response).toEqual(successResponse)
  })

  it('should update the headers information available from config', async () => {
    const url = `${apiUrl}/advanced/routes`
    const successResponse = { message: 'it works' }

    server.use(
      http.post(url, async ({ request }) => {
        expect(request.headers.get('x-lifi-api-key')).toEqual('mock-apikey')
        expect(request.headers.get('x-lifi-integrator')).toEqual('lifi-sdk')
        expect(request.headers.get('x-lifi-sdk')).toEqual(version)
        expect(request.headers.get('x-lifi-userid')).toEqual('user-id')
        expect(request.headers.get('x-lifi-widget')).toEqual(
          'mock-widget-version'
        )

        return HttpResponse.json(successResponse, { status: 200 })
      })
    )

    const options: ExtendedRequestInit = {
      method: 'POST',
      retries: 0,
      headers: {
        'x-lifi-api-key': 'mock-apikey',
        'x-lifi-userid': 'user-id',
        'x-lifi-widget': 'mock-widget-version',
      },
    }

    const response = await request<{ message: string }>(config, url, options)

    expect(response).toEqual(successResponse)
  })

  describe('when dealing with errors', () => {
    it('should throw an error if the Integrator property is missing from the config', async () => {
      const originalIntegrator = config.integrator
      config.integrator = ''

      const url = `${apiUrl}/advanced/routes`

      await expect(
        request<{ message: string }>(config, url, {
          method: 'POST',
          retries: 0,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError(
            'You need to provide the Integrator property. Please see documentation https://docs.li.fi/integrate-li.fi-js-sdk/set-up-the-sdk'
          )
        )
      )

      config.integrator = originalIntegrator
    })
    it('should throw a error with when the request fails', async () => {
      expect.assertions(2)

      const url = `${apiUrl}/advanced/routes`
      const errorResponse = { message: 'something went wrong on the server' }

      server.use(
        http.post(url, async () => {
          return HttpResponse.json(errorResponse, { status: 400 })
        })
      )

      try {
        await request<{ message: string }>(config, url, {
          method: 'POST',
          retries: 0,
        })
      } catch (e) {
        expect((e as SDKError).name).toEqual('SDKError')
        expect(((e as SDKError).cause as HTTPError).status).toEqual(400)
      }
    })
    it('should throw a error and attempt retries when the request fails with a 500', async () => {
      expect.assertions(2)

      const url = `${apiUrl}/advanced/routes`
      const errorResponse = { message: 'something went wrong on the server' }

      server.use(
        http.post(url, async () => {
          return HttpResponse.json(errorResponse, { status: 500 })
        })
      )

      try {
        await request<{ message: string }>(config, url, {
          method: 'POST',
          retries: 0,
        })
      } catch (e) {
        expect((e as SDKError).name).toEqual('SDKError')
        expect(((e as SDKError).cause as HTTPError).status).toEqual(500)
      }
    })
  })
})
