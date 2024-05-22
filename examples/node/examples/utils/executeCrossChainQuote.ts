import type { LiFiStep, StatusResponse } from '@lifi/sdk'
import { getTokenAllowance, setTokenAllowance, getStatus } from '@lifi/sdk'
import type { WalletClientWithPublicActions } from '../types'
import { executeTransaction } from './executeTransaction'

const AddressZero = '0x0000000000000000000000000000000000000000'

export const retryCount = 20

export const retryDelay = ({ count }: { count: number; error: Error }) =>
  Math.min(~~(1 << count) * 200, 3000)

export const executeCrossChainQuote = async (
  client: WalletClientWithPublicActions,
  address: string,
  quote: LiFiStep
) => {
  // Approval
  if (quote.action.fromToken.address !== AddressZero) {
    const approval = await getTokenAllowance(
      quote.action.fromToken,
      address,
      quote.estimate.approvalAddress
    )
    // check approval
    if (!approval) {
      throw 'Failed to load approval'
    }

    // set approval if needed
    if (approval < BigInt(quote.action.fromAmount)) {
      const txHash = await setTokenAllowance({
        walletClient: client,
        spenderAddress: quote.estimate.approvalAddress,
        token: quote.action.fromToken,
        amount: BigInt(quote.action.fromAmount),
      })

      if (txHash) {
        const transcationReceipt = await client.waitForTransactionReceipt({
          hash: txHash,
          retryCount,
          retryDelay,
        })

        console.info(
          `>> Set Token Allowance - transaction complete: amount: ${quote.action.fromToken} txHash: ${transcationReceipt.transactionHash}.`
        )
      }
    }
  }

  const receipt = await executeTransaction(client, quote.transactionRequest!)

  // wait for execution
  let result: StatusResponse
  do {
    await new Promise((res) => {
      setTimeout(() => {
        res(null)
      }, 5000)
    })

    result = await getStatus({
      txHash: receipt.transactionHash,
      bridge: quote.tool,
      fromChain: quote.action.fromChainId,
      toChain: quote.action.toChainId,
    })

    console.info('>> Status update', result)
  } while (result.status !== 'DONE' && result.status !== 'FAILED')

  console.info('>> DONE', result)
}
