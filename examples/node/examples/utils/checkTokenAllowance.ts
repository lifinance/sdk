import type { LiFiStep } from '@lifi/sdk'
import { getTokenAllowance, setTokenAllowance } from '@lifi/sdk'
import type { PrivateKeyAccount, PublicClient, WalletClient } from 'viem'

const AddressZero = '0x0000000000000000000000000000000000000000'

export const checkTokenAllowance = async (
  contactCallsQuoteResponse: LiFiStep,
  account: PrivateKeyAccount,
  client: WalletClient
) => {
  if (contactCallsQuoteResponse.action.fromToken.address !== AddressZero) {
    const approval = await getTokenAllowance(
      contactCallsQuoteResponse.action.fromToken,
      account.address,
      contactCallsQuoteResponse.estimate.approvalAddress
    )

    // set approval if needed
    if (
      approval !== undefined &&
      approval < BigInt(contactCallsQuoteResponse.action.fromAmount)
    ) {
      const txHash = await setTokenAllowance({
        walletClient: client,
        spenderAddress: contactCallsQuoteResponse.estimate.approvalAddress,
        token: contactCallsQuoteResponse.action.fromToken,
        amount: BigInt(contactCallsQuoteResponse.action.fromAmount),
      })

      if (txHash) {
        // client needs to be extended with public actions to have waitForTransactionReceipt function
        // there is currently no native type in viem for this so here we use WalletClient & PublicClient
        const transactionReceipt = await (
          client as WalletClient & PublicClient
        ).waitForTransactionReceipt({
          hash: txHash,
          retryCount: 20,
          retryDelay: ({ count }: { count: number; error: Error }) =>
            Math.min(~~(1 << count) * 200, 3000),
        })
        console.info(
          `>> Set Token Allowance - amount: ${contactCallsQuoteResponse.action.fromAmount} txHash: ${transactionReceipt.transactionHash}.`
        )
      }
    }
  }
}
