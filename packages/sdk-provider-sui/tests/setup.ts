import { createConfig } from '@lifi/sdk'
import { SuiProvider } from '../src/SuiProvider.js'

export const setupTestEnvironment = async () => {
  return await createConfig({
    integrator: 'lifi-sdk',
    providers: [SuiProvider()],
  })
}
