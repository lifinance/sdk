import { describe, expect, it, vi } from 'vitest'
import { buildRouteObject } from './execution.unit.mock.js'
import { executionState } from './executionState.js'

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.2.
describe('executionState.startCount', () => {
  it('counts every started execution of a route id and survives delete', () => {
    const route = { ...buildRouteObject({}), id: 'start-count-route' }
    expect(executionState.startCount(route.id)).toBe(0)

    executionState.create({ route })
    executionState.delete(route.id)
    executionState.create({ route })
    executionState.delete(route.id)

    expect(executionState.startCount(route.id)).toBe(2)
    expect(executionState.startCount('never-started-route')).toBe(0)
  })
})

// Spec 2026-10-01-resume-without-resign-followups-design.md, section 5.2,
// case 3.
describe('executionState.lastEnded', () => {
  it('keeps the route and hook of the last ended execution of a route id', () => {
    const first = { ...buildRouteObject({}), id: 'last-ended-route' }
    const second = { ...first }
    const hook = vi.fn()
    expect(executionState.lastEnded(first.id)).toBeUndefined()

    executionState.create({ route: first })
    executionState.delete(first.id)
    executionState.create({
      route: second,
      executionOptions: { updateRouteHook: hook },
    })
    executionState.delete(second.id)
    // A delete without a running execution keeps the record.
    executionState.delete(second.id)

    expect(executionState.lastEnded(first.id)?.route).toBe(second)
    expect(executionState.lastEnded(first.id)?.updateRouteHook).toBe(hook)
    expect(executionState.lastEnded('never-started-route')).toBeUndefined()
  })
})
