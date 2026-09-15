import type { LiFiStep, StatusResponse } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../actions/getStatus.js', () => ({
  getStatus: vi.fn(),
}))

import { getStatus } from '../../../actions/getStatus.js'
import type { StatusManager } from '../../../core/StatusManager.js'
import type { SDKClient } from '../../../types/core.js'
import { waitForTransactionStatus } from './waitForTransactionStatus.js'

const BRIDGE_LINK = 'https://across.example/tx/0xabc'
const LIFI_LINK = 'https://scan.li.fi/tx/0xabc'

const step = {
  id: 'step-1',
  tool: 'across',
  action: {
    fromChainId: 1,
    fromAddress: '0xowner',
    toChainId: 137,
  },
} as unknown as LiFiStep

const pending = (
  links: { bridgeExplorerLink?: string; lifiExplorerLink?: string } = {}
): StatusResponse =>
  ({
    status: 'PENDING',
    substatus: 'WAIT_DESTINATION_TRANSACTION',
    substatusMessage: 'Bridging',
    sending: { txHash: '0xabc', chainId: 1 },
    receiving: { chainId: 137 },
    ...links,
  }) as unknown as StatusResponse

const done = (): StatusResponse =>
  ({
    status: 'DONE',
    substatus: 'COMPLETED',
    sending: { txHash: '0xabc', chainId: 1 },
    receiving: { txHash: '0xdef', chainId: 137 },
  }) as unknown as StatusResponse

/** Each case needs its own hash: the module memoises in-flight polls by hash. */
let hashCounter = 0
const nextHash = (): string => `0xhash${hashCounter++}`

const run = async (
  responses: StatusResponse[]
): Promise<ReturnType<typeof vi.fn>> => {
  const updateAction = vi.fn()
  const statusManager = { updateAction } as unknown as StatusManager
  for (const response of responses) {
    vi.mocked(getStatus).mockResolvedValueOnce(response)
  }
  await waitForTransactionStatus(
    {} as SDKClient,
    statusManager,
    nextHash(),
    step,
    'RECEIVING_CHAIN',
    1
  )
  return updateAction
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('waitForTransactionStatus', () => {
  it('links a pending bridge to its own explorer when the tool has one', async () => {
    const updateAction = await run([
      pending({ bridgeExplorerLink: BRIDGE_LINK, lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: BRIDGE_LINK })
    )
  })

  it('falls back to the LI.FI explorer, which every recorded transfer has', async () => {
    const updateAction = await run([
      pending({ lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: LIFI_LINK })
    )
  })

  it('leaves the link undefined when the status carries neither', async () => {
    const updateAction = await run([pending(), done()])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({ txLink: undefined })
    )
  })

  it('still reports the substatus alongside the link', async () => {
    const updateAction = await run([
      pending({ lifiExplorerLink: LIFI_LINK }),
      done(),
    ])

    expect(updateAction).toHaveBeenCalledWith(
      step,
      'RECEIVING_CHAIN',
      'PENDING',
      expect.objectContaining({
        substatus: 'WAIT_DESTINATION_TRANSACTION',
        substatusMessage: 'Bridging',
      })
    )
  })
})
