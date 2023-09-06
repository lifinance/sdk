import { ChainsService } from '../src/services/ChainsService'
import { ConfigService } from '../src/services/ConfigService'

export const setupTestEnvironment = async () => {
  const configService = ConfigService.getInstance()
  const chainsService = ChainsService.getInstance()
  const chains = await chainsService.getChains()
  configService.updateChains(chains)
}
