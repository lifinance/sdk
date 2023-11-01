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
    try {
      this.chains = await ApiService.getChains()
    } catch (error) {
      // We try to load chains during initialization of the LiFi class and
      // because we no longer in scope of the constructor we fail silently here
    }
  }

  private async checkLoading() {
    if (this.loadingPromise) {
      await this.loadingPromise
    }
    if (!this.chains.length) {
      await this.loadAvailableChains()
    }
  }

  public static getInstance(): ChainsService {
    if (!this.instance) {
      this.instance = new ChainsService()
    }

    return this.instance
  }

  public async getChainById(chainId: ChainId): Promise<ExtendedChain> {
    await this.checkLoading()

    const chain = this.chains.find((chain) => chain.id === chainId)
    if (!chain) {
      throw new ValidationError(`Unknown chainId passed: ${chainId}.`)
    }

    return chain
  }

  public async getChains(): Promise<ExtendedChain[]> {
    await this.checkLoading()

    return this.chains
  }
}
