import type {
  AddEthereumChainParameter,
  ExtendedChain,
  Token,
} from '@lifi/types'
import { ChainKey, ChainType, CoinKey } from '@lifi/types'
import { rest } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ValidationError } from '../utils/errors'
import { ChainsService } from './ChainsService'
import { ConfigService } from './ConfigService'

let chainsService: ChainsService

const chain1: ExtendedChain = {
  chainType: ChainType.EVM,
  key: ChainKey.ETH,
  name: 'Ethereum',
  coin: CoinKey.ETH,
  id: 1,
  mainnet: true,
  metamask: {} as AddEthereumChainParameter,
  nativeToken: {} as Token,
}

const chain2: ExtendedChain = {
  chainType: ChainType.EVM,
  key: ChainKey.POL,
  name: 'Polygon',
  coin: CoinKey.MATIC,
  id: 137,
  mainnet: true,
  metamask: {} as AddEthereumChainParameter,
  nativeToken: {} as Token,
}

describe('ChainsService', () => {
  const config = ConfigService.getInstance().getConfig()
  const server = setupServer(
    rest.get(`${config.apiUrl}/chains`, async (_, response, context) =>
      response(context.json({ chains: [chain1, chain2] }))
    )
  )
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    chainsService = ChainsService.getInstance()
  })
  afterAll(() => server.close())

  describe('getChains', () => {
    it('should load and return the chains', async () => {
      const result = await chainsService.getChains()
      expect(result).toEqual([chain1, chain2])
    })
  })

  describe('getChainById', () => {
    it('should throw an error if the chain is unknown', async () => {
      await expect(
        chainsService.getChainById(1337 as any)
      ).rejects.toThrowError(
        new ValidationError(`Unknown chainId passed: ${1337}.`)
      )
    })

    it('should return the chain if found', async () => {
      const result = await chainsService.getChainById(chain1.id)
      expect(result).toEqual(chain1)
    })
  })
})
