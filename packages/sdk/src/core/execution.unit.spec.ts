import { describe, expect, it } from 'vitest'
import type { RouteExtended, SDKClient } from '../types/core.js'
import { resumeRoute } from './execution.js'

describe('resumeRoute', () => {
  it('prepares the restart on a copy and leaves the caller route unchanged', async () => {
    // Step already DONE, so executeSteps skips it and no provider is needed.
    const route = {
      id: 'route-clone-test',
      steps: [
        {
          id: 'step-1',
          action: { fromAddress: '0xabc' },
          transactionRequest: { data: '0xdata' },
          execution: {
            startedAt: 0,
            status: 'DONE',
            actions: [
              {
                type: 'SWAP',
                status: 'FAILED',
                txHash: '0xswap',
                txFinal: true,
              },
            ],
          },
        },
      ],
    } as unknown as RouteExtended
    const before = JSON.parse(JSON.stringify(route))

    const resumed = await resumeRoute(
      { providers: [] } as unknown as SDKClient,
      route
    )

    expect(JSON.parse(JSON.stringify(route))).toEqual(before)
    expect(resumed.steps[0].execution!.actions).toEqual([])
    expect(resumed.steps[0].transactionRequest).toBeUndefined()
  })
})
