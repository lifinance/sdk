import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { client, setupTestServer } from '../actions/actions.unit.handlers.js'
import { ErrorName, LiFiErrorCode } from '../errors/constants.js'
import type { HTTPError } from '../errors/httpError.js'
import { SDKError } from '../errors/SDKError.js'
import { request } from './request.js'

vi.mock('./sleep.js', () => ({
  sleep: () => Promise.resolve(null),
}))

describe('quote request failures', () => {
  const server = setupTestServer()
  const url = `${client.config.apiUrl}/quote`

  it('maps a 4xx from the quote API to ValidationError and does not retry it', async () => {
    let calls = 0
    server.use(
      http.get(url, () => {
        calls += 1
        return HttpResponse.json(
          { message: 'Invalid quote request' },
          { status: 400, statusText: 'Bad Request' }
        )
      })
    )

    const error = await request(client.config, url, {
      method: 'GET',
      retries: 2,
    }).catch((caught: unknown) => caught)

    expect(calls).toBe(1)
    expect(error).toBeInstanceOf(SDKError)
    const sdkError = error as SDKError
    expect(sdkError.code).toBe(LiFiErrorCode.ValidationError)
    const cause = sdkError.cause as HTTPError
    expect(cause.status).toBe(400)
    expect(cause.code).toBe(LiFiErrorCode.ValidationError)
    expect(cause.type).toBe(ErrorName.ValidationError)
  })

  it('retries a 500 from the quote API', async () => {
    let calls = 0
    server.use(
      http.get(url, () => {
        calls += 1
        return HttpResponse.json(
          { message: 'quote backend unavailable' },
          { status: 500, statusText: 'Internal Server Error' }
        )
      })
    )

    const error = await request(client.config, url, {
      method: 'GET',
      retries: 1,
    }).catch((caught: unknown) => caught)

    expect(calls).toBe(2)
    expect(error).toBeInstanceOf(SDKError)
    expect((error as SDKError).code).toBe(LiFiErrorCode.InternalError)
  })
})
