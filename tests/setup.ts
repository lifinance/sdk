import { createConfig } from '../src/createConfig.js'
import { EVM, Solana, Sui, UTXO } from '../src/index.js'

export const setupTestEnvironment = async () => {
  return createConfig({
    integrator: 'lifi-sdk',
    providers: [EVM(), Solana(), UTXO(), Sui()],
  })
}
