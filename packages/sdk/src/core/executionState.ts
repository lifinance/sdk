import type {
  ExecutionOptions,
  RouteExtended,
  StepExecutor,
  UpdateRouteHook,
} from '../types/core.js'

interface ExecutionData {
  route: RouteExtended
  executors: StepExecutor[]
  executionOptions?: ExecutionOptions
  promise?: Promise<RouteExtended>
}

type ExecutionStateParams = Omit<ExecutionData, 'executors'>

/** The route and hook of an execution that ended (stopped or finished). */
interface EndedExecution {
  route: RouteExtended
  updateRouteHook?: UpdateRouteHook
}

interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  /**
   * Executions started per route id. Survives `delete`, so a stopped run can
   * tell whether a newer execution of its route started since its stop.
   */
  starts: Partial<Record<string, number>>
  /**
   * The last ended execution per route id. Survives `delete`, so a late write
   * of a stopped run can reach the route of a newer execution that ended.
   */
  ended: Partial<Record<string, EndedExecution>>
  get(routeId: string): ExecutionData | undefined
  create(params: ExecutionStateParams): ExecutionData
  update(params: ExecutionStateParams): void
  delete(routeId: string): void
  startCount(routeId: string): number
  lastEnded(routeId: string): EndedExecution | undefined
}

export const executionState: ExecutionState = {
  state: {},
  starts: {},
  ended: {},
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
    const data = this.state[routeId]
    if (data) {
      this.ended[routeId] = {
        route: data.route,
        updateRouteHook: data.executionOptions?.updateRouteHook,
      }
    }
    delete this.state[routeId]
  },
  startCount(routeId: string): number {
    return this.starts[routeId] ?? 0
  },
  lastEnded(routeId: string): EndedExecution | undefined {
    return this.ended[routeId]
  },
}
