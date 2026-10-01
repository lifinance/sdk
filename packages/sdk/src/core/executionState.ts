import type {
  ExecutionOptions,
  RouteExtended,
  StepExecutor,
} from '../types/core.js'

interface ExecutionData {
  route: RouteExtended
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
  promise?: Promise<RouteExtended>
}

type ExecutionStateParams = Omit<ExecutionData, 'executors'>

interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  /**
   * Executions started per route id. Survives `delete`, so a stopped run can
   * tell whether a newer execution of its route started since its stop.
   */
  starts: Partial<Record<string, number>>
  get(routeId: string): ExecutionData | undefined
  create(params: ExecutionStateParams): ExecutionData
  update(params: ExecutionStateParams): void
  delete(routeId: string): void
  startCount(routeId: string): number
}

export const executionState: ExecutionState = {
  state: {},
  starts: {},
  get(routeId: string) {
    return this.state[routeId]
  },
  create(params) {
    this.starts[params.route.id] = this.startCount(params.route.id) + 1
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
  startCount(routeId: string): number {
    return this.starts[routeId] ?? 0
  },
}
