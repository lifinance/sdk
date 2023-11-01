import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { beforeAll, describe, expect, it } from 'vitest'
import { LiFi } from './LiFi'
import { requestSettings } from './request'
import ChainsService from './services/ChainsService'
import ConfigService from './services/ConfigService'
import { ValidationError } from './utils/errors'

describe('LI.FI SDK', () => {
  const config = ConfigService.getInstance().getConfig()
  const server = setupServer()
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
    // server.use(...handlers)
  })

  describe('LI.FI SDK initialization', () => {
    it('should handle instance creation if chains request fails', async () => {
      server.use(
        http.get(`${config.apiUrl}/chains`, async () =>
          HttpResponse.json({ message: 'Oops' }, { status: 500 })
        )
      )
      new LiFi({
        integrator: 'test-example',
      })

      await expect(
        ChainsService.getInstance().getChainById(1)
      ).rejects.toThrowError(
        new ValidationError(`Unknown chainId passed: ${1}.`)
      )

      server.use(
        http.get(`${config.apiUrl}/chains`, async () =>
          HttpResponse.json({ chains: [{ id: 1, name: 'EthereumTest' }] })
        )
      )

      const chain = await ChainsService.getInstance().getChainById(1)

      expect(chain.name).toBe('EthereumTest')
    })
  })
})
