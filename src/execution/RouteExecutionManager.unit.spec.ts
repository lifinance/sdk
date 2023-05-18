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
import { buildRouteObject, buildStepObject } from '../../test/fixtures'
import { Signer } from 'ethers'
import { lifiHandlers } from './RouteExecutionManager.unit.handlers'
import { requestSettings } from '../request'
import { RouteExecutionManager } from './RouteExecutionManager'
import { setupServer } from 'msw/node'

vi.mock('../balance', () => ({
  checkBalance: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../execution/switchChain', () => ({
  switchChain: vi.fn(() => Promise.resolve(signer)),
}))

vi.mock('../allowance/utils', () => ({
  getApproved: vi.fn(() => Promise.resolve([])),
}))

let signer: Signer
const step = buildStepObject({
  includingExecution: true,
})

const routeExecutionManager: RouteExecutionManager = new RouteExecutionManager({
  integrator: 'test-example',
})

describe('Should pick up gas from signer estimation', () => {
  const server = setupServer(...lifiHandlers)

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

  beforeEach(() => {
    requestSettings.retries = 0
    vi.clearAllMocks()

    signer = {
      estimateGas: vi.fn(() => Promise.resolve(100000)),
      getGasPrice: vi.fn(() => Promise.resolve(100000)),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: '0xabc',
        wait: () => Promise.resolve({ hash: '0xabc' }),
      }),
      getChainId: () => 137,
    } as unknown as Signer
  })

  afterEach(() => server.resetHandlers())
  afterAll(() => {
    server.close()
  })

  it('should pick up gas limit + price estimation from signer', async () => {
    const route = buildRouteObject({
      step,
    })

    await routeExecutionManager.executeRoute(signer, route)

    expect(signer.sendTransaction).toHaveBeenCalledWith({
      gasLimit: '125000',
      gasPrice: '125000',
      // TODO: Check the cause for gasLimit being outside transactionRequest. Currently working as expected in widget
      transactionRequest: {
        chainId: 137,
        data: '0xdata',
        from: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
        gasLimit: '682701',
        gasPrice: '0x27c01c1727',
        to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
        value: '0x0600830dbc7f5bf7',
      },
    })
  })
})
