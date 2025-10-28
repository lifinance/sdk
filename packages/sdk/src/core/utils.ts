import type { ChainId, ExtendedChain, LiFiStep } from '@lifi/types'
import type { RPCUrls } from '../types/core.js'

// Standard threshold for destination amount difference (0.5%)
const standardThreshold = 0.005

/**
 * Used to check if changed exchange rate is in the range of slippage threshold.
 * We use a slippage value as a threshold to trigger the rate change hook.
 * This can result in almost doubled slippage for the user and need to be revisited.
 * @param oldStep - old step
 * @param newStep - new step
 * @returns Boolean
 */
export function checkStepSlippageThreshold(
  oldStep: LiFiStep,
  newStep: LiFiStep
): boolean {
  const setSlippage = oldStep.action.slippage || standardThreshold
  const oldEstimatedToAmount = BigInt(oldStep.estimate.toAmountMin)
  const newEstimatedToAmount = BigInt(newStep.estimate.toAmountMin)
  const amountDifference = oldEstimatedToAmount - newEstimatedToAmount
  // oldEstimatedToAmount can be 0 when we use contract calls
  let actualSlippage = 0
  if (oldEstimatedToAmount > 0) {
    actualSlippage =
      Number((amountDifference * 1_000_000_000n) / oldEstimatedToAmount) /
      1_000_000_000
  }
  return actualSlippage <= setSlippage
}

export function getRpcUrlsFromChains(
  existingRpcUrls: RPCUrls,
  chains: ExtendedChain[],
  skipChains?: ChainId[]
) {
  const rpcUrlsFromChains = chains.reduce((rpcUrls, chain) => {
    if (chain.metamask?.rpcUrls?.length) {
      rpcUrls[chain.id as ChainId] = chain.metamask.rpcUrls
    }
    return rpcUrls
  }, {} as RPCUrls)
  const result = { ...existingRpcUrls }
  for (const rpcUrlsKey in rpcUrlsFromChains) {
    const chainId = Number(rpcUrlsKey) as ChainId
    const urls = rpcUrlsFromChains[chainId]
    if (!urls?.length) {
      continue
    }
    if (!result[chainId]?.length) {
      result[chainId] = Array.from(urls)
    } else if (!skipChains?.includes(chainId)) {
      const filteredUrls = urls.filter((url) => !result[chainId]?.includes(url))
      result[chainId].push(...filteredUrls)
    }
  }
  return result
}
