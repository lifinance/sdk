import type { LiFiStep, Process } from '@lifi/types'
import { formatUnits } from 'viem'
import { config } from '../config.js'

export const getTransactionNotSentMessage = async (
  step?: LiFiStep,
  process?: Process
): Promise<string> => {
  let transactionNotSend =
    'Transaction was not sent, your funds are still in your wallet'

  // add information about funds if available
  if (step) {
    const chain = await config.getChainById(step.action.fromChainId)

    transactionNotSend += ` (${formatUnits(
      BigInt(step.action.fromAmount),
      step.action.fromToken.decimals
    )} ${step.action.fromToken.symbol} on ${chain.name})`
  }

  transactionNotSend +=
    ", please retry.<br/>If it still doesn't work, it is safe to delete this transfer and start a new one."

  // add transaction explorer link if available
  transactionNotSend += process?.txLink
    ? `<br>You can check the failed transaction&nbsp;<a href="${process.txLink}" target="_blank" rel="nofollow noreferrer">here</a>.`
    : ''

  return transactionNotSend
}

export const getTransactionFailedMessage = async (
  step: LiFiStep,
  txLink?: string
): Promise<string> => {
  const chain = await config.getChainById(step.action.toChainId)

  const baseString = `It appears that your transaction may not have been successful.
  However, to confirm this, please check your ${chain.name} wallet for ${step.action.toToken.symbol}.`
  return txLink
    ? `${baseString}
    You can also check the&nbsp;<a href="${txLink}" target="_blank" rel="nofollow noreferrer">block explorer</a> for more information.`
    : baseString
}
