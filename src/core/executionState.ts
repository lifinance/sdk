import type { ExecutionOptions, RouteExtended, StepExecutor } from './types.js'

export interface ExecutionData {
  route: RouteExtended
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
  promise?: Promise<RouteExtended>
}

export interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  get(routeId: string): ExecutionData | undefined
  create(
    route: RouteExtended,
    executionOptions?: ExecutionOptions,
    promise?: Promise<RouteExtended>
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
