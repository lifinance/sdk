import { findDefaultToken } from '@lifi/data-types'
import type { ConnectionsRequest } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
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
import * as request from '../request.js'
import { requestSettings } from '../request.js'
import { config, handlers } from './api.unit.handlers.js'
import { getConnections } from './getConnections.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getConnections', () => {
  const server = setupServer(...handlers)

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => server.resetHandlers())

  afterAll(() => {
    requestSettings.retries = 1
    server.close()
  })

  it('returns empty array in response', async () => {
    server.use(
      http.get(`${config.apiUrl}/connections`, async () =>
        HttpResponse.json({ connections: [] })
      )
    )

    const connectionRequest: ConnectionsRequest = {
      fromChain: ChainId.BSC,
      toChain: ChainId.OPT,
      fromToken: findDefaultToken(CoinKey.USDC, ChainId.BSC).address,
      toToken: findDefaultToken(CoinKey.USDC, ChainId.OPT).address,
      allowBridges: ['connext', 'uniswap', 'polygon'],
      allowExchanges: ['1inch', 'ParaSwap', 'SushiSwap'],
      denyBridges: ['Hop', 'Multichain'],
      preferBridges: ['Hyphen', 'Across'],
      denyExchanges: ['UbeSwap', 'BeamSwap'],
      preferExchanges: ['Evmoswap', 'Diffusion'],
    }

    const generatedURL =
      'https://li.quest/v1/connections?fromChain=56&fromToken=0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d&toChain=10&toToken=0x0b2c639c533813f4aa9d7837caf62653d097ff85&allowBridges=connext&allowBridges=uniswap&allowBridges=polygon&denyBridges=Hop&denyBridges=Multichain&preferBridges=Hyphen&preferBridges=Across&allowExchanges=1inch&allowExchanges=ParaSwap&allowExchanges=SushiSwap&denyExchanges=UbeSwap&denyExchanges=BeamSwap&preferExchanges=Evmoswap&preferExchanges=Diffusion'

    await expect(getConnections(config, connectionRequest)).resolves.toEqual({
      connections: [],
    })

    expect((mockedFetch.mock.calls[0][1] as URL).href).toEqual(generatedURL)
    expect(mockedFetch).toHaveBeenCalledOnce()
  })
})
