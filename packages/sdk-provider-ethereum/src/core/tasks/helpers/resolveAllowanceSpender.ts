import type { TransactionMethodType } from '@lifi/sdk'
import type { Address } from 'viem'
import type { EthereumStepExecutorContext } from '../../../types.js'
import { resolvePermit2Support } from './resolvePermit2Support.js'

/**
 * The spender the allowance tasks check and approve in `strategy`: canonical
 * Permit2 when the step takes the Permit2 flow there, `approvalAddress`
 * otherwise. Every allowance task and the prepare-time check use this one
 * derivation, so they cannot disagree.
 */
export const resolveAllowanceSpender = async (
  context: EthereumStepExecutorContext,
  strategy: TransactionMethodType
): Promise<{ permit2Supported: boolean; spenderAddress: Address }> => {
  const permit2Supported = await resolvePermit2Support(context, strategy)
  const { fromChain, step } = context
  return {
    permit2Supported,
    spenderAddress: (permit2Supported
      ? fromChain.permit2
      : step.estimate.approvalAddress) as Address,
  }
}
