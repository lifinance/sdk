import { supportedChains } from '@lifi/types'
import ConfigService from '../src/services/ConfigService'

export const setupTestEnvironment = () => {
  const configService = ConfigService.getInstance()
  configService.updateChains(supportedChains)
}
