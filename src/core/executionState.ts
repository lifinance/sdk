import type { ExecutionOptions, RouteExtended, StepExecutor } from './types.js'

interface ExecutionData {
  route: RouteExtended
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
  promise?: Promise<RouteExtended>
}

type ExecutionStateParams = Omit<ExecutionData, 'executors'>

interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  get(routeId: string): ExecutionData | undefined
  create(params: ExecutionStateParams): ExecutionData
  update(params: ExecutionStateParams): void
  delete(routeId: string): void
}

export const executionState: ExecutionState = {
  state: {},
  get(routeId: string) {
    return this.state[routeId]
  },
  create(params) {
    this.state[params.route.id] = {
      ...this.state[params.route.id],
      ...params,
      executors: this.state[params.route.id]?.executors ?? [],
    }
    return this.state[params.route.id]!
  },
  update(state) {
    if (this.state[state.route.id]) {
      this.state[state.route.id] = {
        ...this.state[state.route.id]!,
        ...state,
      }
    }
  },
  delete(routeId) {
    delete this.state[routeId]
  },
}
