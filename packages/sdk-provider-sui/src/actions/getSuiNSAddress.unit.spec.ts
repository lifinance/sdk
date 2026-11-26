import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSuiNSAddress } from './getSuiNSAddress.js'

const requestUrl = (input: unknown): string =>
  input instanceof Request ? input.url : String(input)

describe('getSuiNSAddress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The real SuiGrpcClient checks its URL when it is built. @mysten/sui 3 made
  // getJsonRpcFullnodeUrl throw, which only showed at run time.
  it('sends the lookup to the mainnet full node when no RPC URL is given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(getSuiNSAddress('example.sui')).resolves.toBeUndefined()

    expect(fetchSpy).toHaveBeenCalled()
    expect(requestUrl(fetchSpy.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/fullnode\.mainnet\.sui\.io(:443)?\//
    )
  })

  it('sends the lookup to the given RPC URL', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(
      getSuiNSAddress('example.sui', 'https://sui.example.com')
    ).resolves.toBeUndefined()

    expect(requestUrl(fetchSpy.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/sui\.example\.com\//
    )
  })
})
