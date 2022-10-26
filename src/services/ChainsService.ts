import { ChainId, ExtendedChain } from '@lifi/types'
import { ValidationError } from '../utils/errors'
import ApiService from './ApiService'

export default class ChainsService {
  private static instance: ChainsService
  private readonly loadingPromise: Promise<void>
  private chains: ExtendedChain[] = []

  constructor() {
    this.loadingPromise = this.loadAvailableChains()
  }

  private async loadAvailableChains(): Promise<void> {
    this.chains = await ApiService.getChains()
  }

  public static getInstance(): ChainsService {
    if (!this.instance) {
      this.instance = new ChainsService()
    }

    return this.instance
  }

  public async getChainById(chainId: ChainId): Promise<ExtendedChain> {
    if (this.loadingPromise) {
      await this.loadingPromise
    }

    const chain = this.chains.find((chain) => chain.id === chainId)
    if (!chain) {
      throw new ValidationError(`Unknown chainId passed: ${chainId}.`)
    }

    return chain
  }

  public async getChains(): Promise<ExtendedChain[]> {
    if (this.loadingPromise) {
      await this.loadingPromise
    }

    return this.chains
  }
}
