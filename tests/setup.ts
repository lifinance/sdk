import { ChainsService } from '../src/services/ChainsService.js'
import { ConfigService } from '../src/services/ConfigService.js'

export const setupTestEnvironment = async () => {
  const configService = ConfigService.getInstance()
  const chainsService = ChainsService.getInstance()
  const chains = await chainsService.getChains()
  configService.updateChains(chains)
}
