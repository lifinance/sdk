import { createConfig } from '../src/createConfig.js'
import { EVM, Solana } from '../src/index.js'

export const setupTestEnvironment = () => {
  createConfig({
    integrator: 'lifi-sdk',
    providers: [EVM(), Solana()],
  })
}
