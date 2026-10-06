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
  /**
   * One per execution: `stopRouteExecution` aborts it, so the waits of the
   * stopped run that take its signal end.
   */
  abortController: AbortController
}

type ExecutionStateParams = Omit<ExecutionData, 'executors' | 'abortController'>

/** The route and hook of an execution that ended (stopped or finished). */
interface EndedExecution {
  route: RouteExtended
  updateRouteHook?: UpdateRouteHook
}

interface ExecutionState {
  state: Partial<Record<string, ExecutionData>>
  /**
   * The start number of the last execution per route id. Survives `delete`
   * while a run of the route is in flight, so a stopped run can tell whether
   * a newer execution of its route started since its stop.
   */
  starts: Partial<Record<string, number>>
  /**
   * The last ended execution per route id. Kept only while a run of the
   * route is in flight, so a late write of a stopped run can reach the route
   * of a newer execution that ended.
   */
  ended: Partial<Record<string, EndedExecution>>
  /** Runs per route id inside a step (`retain` to `release`). */
  inFlight: Partial<Record<string, number>>
  get(routeId: string): ExecutionData | undefined
  create(params: ExecutionStateParams): ExecutionData
  update(params: ExecutionStateParams): void
  delete(routeId: string): void
  retain(routeId: string): void
  release(routeId: string): void
  /**
   * The start number of the last execution of the route id, or 0 when the
   * route has no records. A new start always gets a higher number.
   */
  startCount(routeId: string): number
  lastEnded(routeId: string): EndedExecution | undefined
}

/**
 * The last start number given to any route id. A number is never given
 * twice, so a route id whose records were freed and that started again never
 * shows the number a stopped run took at its stop.
 */
let lastStart = 0

export const executionState: ExecutionState = {
  state: {},
  starts: {},
  ended: {},
  inFlight: {},
  get(routeId: string) {
    return this.state[routeId]
  },
  create(params) {
    lastStart += 1
    this.starts[params.route.id] = lastStart
    this.state[params.route.id] = {
      ...this.state[params.route.id],
      ...params,
      executors: this.state[params.route.id]?.executors ?? [],
      abortController: new AbortController(),
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
    delete this.state[routeId]
    // No run of the route is in flight, so no stopped run can write late:
    // nothing is kept. (A normal finish releases its run before its delete.)
    if (!this.inFlight[routeId]) {
      delete this.starts[routeId]
      delete this.ended[routeId]
      return
    }
    if (data) {
      this.ended[routeId] = {
        route: data.route,
        updateRouteHook: data.executionOptions?.updateRouteHook,
      }
    }
  },
  retain(routeId) {
    this.inFlight[routeId] = (this.inFlight[routeId] ?? 0) + 1
  },
  release(routeId) {
    const count = (this.inFlight[routeId] ?? 0) - 1
    if (count > 0) {
      this.inFlight[routeId] = count
      return
    }
    delete this.inFlight[routeId]
    // A running execution keeps its records until its own `delete`.
    if (!this.state[routeId]) {
      delete this.starts[routeId]
      delete this.ended[routeId]
    }
  },
  startCount(routeId: string): number {
    return this.starts[routeId] ?? 0
  },
  lastEnded(routeId: string): EndedExecution | undefined {
    return this.ended[routeId]
  },
}
