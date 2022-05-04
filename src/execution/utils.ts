import { BridgeTool, ExchangeTools, StatusResponse } from '@lifinance/types'
import { ChainId } from '..'
import ApiService from '../services/ApiService'
import { ServerError } from '../utils/errors'
import { repeatUntilDone } from '../utils/utils'

export async function waitForReceivingTransaction(
  tool: BridgeTool | ExchangeTools,
  fromChainId: ChainId,
  toChainId: ChainId,
  txHash: string
): Promise<StatusResponse> {
  const getStatus = (): Promise<StatusResponse | undefined> =>
    new Promise(async (resolve, reject) => {
      let statusResponse: StatusResponse
      try {
        statusResponse = await ApiService.getStatus({
          bridge: tool,
          fromChain: fromChainId,
          toChain: toChainId,
          txHash,
        })
      } catch (e: any) {
        console.debug('Fetching status from backend failed', e)
        return resolve(undefined)
      }

      switch (statusResponse.status) {
        case 'DONE':
          return resolve(statusResponse)
        case 'PENDING':
        case 'NOT_FOUND':
          return resolve(undefined)
        case 'FAILED':
        default:
          return reject()
      }
    })

  const status = await repeatUntilDone(getStatus, 5_000)

  if (!status.receiving) {
    throw new ServerError("Status doesn't contain receiving information.")
  }

  return status
}
