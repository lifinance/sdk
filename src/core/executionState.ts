import type { Route } from '@lifi/types'
import type { ExecutionOptions, StepExecutor } from './types.js'

export interface ExecutionData {
  route: Route
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
  promise?: Promise<Route>
}

export interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  get(routeId: string): ExecutionData | undefined
  create(
    route: Route,
    executionOptions?: ExecutionOptions,
    promise?: Promise<Route>
  ): ExecutionData
  delete(routeId: string): void
}

export const executionState: ExecutionState = {
  state: {},
  get(routeId: string) {
    return this.state[routeId]
  },
  create(route, executionOptions, promise) {
    this.state[route.id] = {
      ...this.state[route.id],
      route,
      executionOptions,
      promise,
      executors: [],
    }
    return this.state[route.id]!
  },
  delete(routeId) {
    delete this.state[routeId]
  },
}
