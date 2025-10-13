import { createConfig } from '@lifi/sdk'
import { SolanaProvider } from '../src/SolanaProvider.js'

export const setupTestEnvironment = async () => {
  return await createConfig({
    integrator: 'lifi-sdk',
    providers: [SolanaProvider()],
  })
}
