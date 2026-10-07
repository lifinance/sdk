import { describe, expect, it } from 'vitest'
import type { ExecutionAction, RouteExtended } from '../types/core.js'
import { prepareRestart } from './prepareRestart.js'

const routeWith = (actions: ExecutionAction[]): RouteExtended =>
  ({
    id: 'route-1',
    steps: [
      {
        id: 'step-1',
        transactionRequest: { data: '0xdata' },
        execution: { startedAt: 0, status: 'FAILED', actions },
      },
    ],
  }) as unknown as RouteExtended

const actionsOf = (route: RouteExtended): ExecutionAction[] =>
  route.steps[0].execution!.actions

describe('prepareRestart', () => {
  it('keeps a FAILED tx action with an unknown outcome and sets it to PENDING', () => {
    const route = routeWith([
      { type: 'SET_ALLOWANCE', status: 'DONE', txHash: '0xapprove' },
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: '0xswap',
        message: 'Swap failed',
        error: { code: 1003, message: 'Transaction confirmation timeout.' },
      },
    ])

    prepareRestart(route)

    const [allowance, swap] = actionsOf(route)
    expect(allowance.status).toBe('DONE')
    expect(swap.status).toBe('PENDING')
    expect(swap.txHash).toBe('0xswap')
    expect(swap.error).toBeUndefined()
    expect(swap.message).toBe('Waiting for swap transaction')
    expect(route.steps[0].transactionRequest).toBeUndefined()
  })

  it('keeps an action that has only stored signed bytes', () => {
    const route = routeWith([{ type: 'SWAP', status: 'FAILED', txHex: 'AQID' }])

    prepareRestart(route)

    expect(actionsOf(route)).toHaveLength(1)
    expect(actionsOf(route)[0].status).toBe('PENDING')
  })

  it('drops a FAILED tx action with a final outcome', () => {
    const route = routeWith([
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: '0xswap',
        txFinal: true,
      },
    ])

    prepareRestart(route)

    expect(actionsOf(route)).toEqual([])
  })

  it('drops everything when no action has transaction data', () => {
    const route = routeWith([
      { type: 'CHECK_ALLOWANCE', status: 'DONE' },
      { type: 'SWAP', status: 'FAILED' },
    ])

    prepareRestart(route)

    expect(actionsOf(route)).toEqual([])
  })

  it('treats every step of a multi-step route on its own', () => {
    const route = {
      id: 'route-2',
      steps: [
        {
          id: 'step-1',
          execution: {
            startedAt: 0,
            status: 'DONE',
            actions: [{ type: 'SWAP', status: 'DONE', txHash: '0xfirst' }],
          },
        },
        {
          id: 'step-2',
          execution: {
            startedAt: 0,
            status: 'FAILED',
            actions: [
              { type: 'CROSS_CHAIN', status: 'FAILED', txHash: '0xsecond' },
            ],
          },
        },
      ],
    } as unknown as RouteExtended

    prepareRestart(route)

    expect(route.steps[0].execution!.actions[0]).toMatchObject({
      status: 'DONE',
      txHash: '0xfirst',
    })
    expect(route.steps[1].execution!.actions[0]).toMatchObject({
      status: 'PENDING',
      txHash: '0xsecond',
    })
  })

  it('keeps a DONE bridge action and drops a failed RECEIVING_CHAIN without a hash', () => {
    const route = routeWith([
      { type: 'CROSS_CHAIN', status: 'DONE', txHash: '0xsource' },
      { type: 'RECEIVING_CHAIN', status: 'FAILED' },
    ])

    prepareRestart(route)

    expect(actionsOf(route).map((a) => a.type)).toEqual(['CROSS_CHAIN'])
    expect(actionsOf(route)[0].status).toBe('DONE')
  })
})
