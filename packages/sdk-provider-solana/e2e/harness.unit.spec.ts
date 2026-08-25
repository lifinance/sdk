import type { RouteExtended } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { observeRouteWrites } from './harness.js'

const routeWith = (action: {
  txHash?: string
  txLink?: string
}): RouteExtended =>
  ({
    steps: [{ execution: { actions: [{ type: 'SWAP', ...action }] } }],
  }) as unknown as RouteExtended

describe('observeRouteWrites', () => {
  it('records the order in which txHash and txLink first appear', () => {
    // PR #448 writes txHash at signing and txLink only once an RPC accepts
    // the send. Asserting the ORDER is what proves the deferral: asserting
    // only the final state passes even if both were written at signing.
    const { hook, observed } = observeRouteWrites()

    hook(routeWith({ txHash: 'sig' }))
    hook(routeWith({ txHash: 'sig', txLink: 'https://explorer/tx/sig' }))

    expect(observed.order).toEqual(['txHash', 'txLink'])
    expect(observed.txHashAt).toBeDefined()
    expect(observed.txLinkAt).toBeDefined()
  })

  it('records nothing for a route whose action has neither field', () => {
    const { hook, observed } = observeRouteWrites()
    hook(routeWith({}))
    expect(observed.order).toEqual([])
    expect(observed.txHashAt).toBeUndefined()
  })

  it('records each field only the first time it appears', () => {
    const { hook, observed } = observeRouteWrites()
    hook(routeWith({ txHash: 'sig' }))
    hook(routeWith({ txHash: 'sig' }))
    hook(routeWith({ txHash: 'sig' }))
    expect(observed.txHashAt).toBe(1)
    expect(observed.txLinkAt).toBeUndefined()
  })

  it('reports a single combined write as `together`, not as an order', () => {
    // The regression this observer exists to catch: one write at signing
    // carrying both fields. Source order inside the hook would report
    // ['txHash','txLink'] here and pass the deferral assertion.
    const { hook, observed } = observeRouteWrites()
    hook(routeWith({ txHash: 'sig', txLink: 'https://explorer/tx/sig' }))
    expect(observed.order).toEqual(['together'])
    expect(observed.order[0]).not.toBe('txHash')
  })

  it('records txLink first when a route presents it first', () => {
    // The observer must report what happened, not what should have. If it
    // hardcoded the expected order it could never catch a regression.
    const { hook, observed } = observeRouteWrites()
    hook(routeWith({ txLink: 'https://explorer/tx/sig' }))
    hook(routeWith({ txHash: 'sig', txLink: 'https://explorer/tx/sig' }))
    expect(observed.order).toEqual(['txLink', 'txHash'])
  })
})
