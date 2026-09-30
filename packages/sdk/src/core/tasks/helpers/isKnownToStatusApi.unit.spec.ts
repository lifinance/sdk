import type { LiFiStep, StatusResponse } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../actions/getStatus.js', () => ({
  getStatus: vi.fn(),
}))

import { getStatus } from '../../../actions/getStatus.js'
import type { SDKClient } from '../../../types/core.js'
import { isKnownToStatusApi } from './isKnownToStatusApi.js'

const step = {
  id: 'step-1',
  tool: 'jupiter',
  transactionId: 'tx-id-1',
  action: {
    fromChainId: 1151111081099710,
    fromAddress: 'SoLaNaAddress',
    toChainId: 1151111081099710,
  },
} as unknown as LiFiStep

const respond = (status: string): void => {
  vi.mocked(getStatus).mockResolvedValueOnce({
    status,
  } as unknown as StatusResponse)
}

describe('isKnownToStatusApi', () => {
  beforeEach(() => {
    vi.mocked(getStatus).mockReset()
  })

  it.each(['PENDING', 'DONE', 'FAILED', 'INVALID'])(
    'is true for a 200 with status %s',
    async (status) => {
      respond(status)
      expect(await isKnownToStatusApi({} as SDKClient, step, 'sig')).toBe(true)
    }
  )

  it('is false for an explicit NOT_FOUND status', async () => {
    respond('NOT_FOUND')
    expect(await isKnownToStatusApi({} as SDKClient, step, 'sig')).toBe(false)
  })

  it('is false for HTTP 404, which the API also returns for landed transactions it does not index', async () => {
    vi.mocked(getStatus).mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { status: 404, code: 1003 })
    )
    expect(await isKnownToStatusApi({} as SDKClient, step, 'sig')).toBe(false)
  })

  it('is false when the API call fails for any other reason', async () => {
    vi.mocked(getStatus).mockRejectedValueOnce(new Error('503'))
    expect(await isKnownToStatusApi({} as SDKClient, step, 'sig')).toBe(false)
  })

  it('sends the same request fields as the status poll', async () => {
    respond('PENDING')
    await isKnownToStatusApi({} as SDKClient, step, 'sig')
    expect(getStatus).toHaveBeenCalledWith(
      {},
      {
        fromChain: 1151111081099710,
        fromAddress: 'SoLaNaAddress',
        toChain: 1151111081099710,
        txHash: 'sig',
        bridge: 'jupiter',
        transactionId: 'tx-id-1',
      }
    )
  })

  it('omits bridge for custom steps', async () => {
    respond('PENDING')
    await isKnownToStatusApi(
      {} as SDKClient,
      { ...step, tool: 'custom' } as LiFiStep,
      'sig'
    )
    expect(vi.mocked(getStatus).mock.calls[0][1]).not.toHaveProperty('bridge')
  })
})
