import { describe, expect, it } from 'vitest'
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
