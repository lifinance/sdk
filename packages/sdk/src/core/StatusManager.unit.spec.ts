import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutionAction,
  ExecutionActionStatus,
  ExecutionActionType,
  ExecutionStatus,
  LiFiStepExtended,
} from '../types/core.js'
import { stopRouteExecution } from './execution.js'
import {
  attachStatusManager,
  buildRouteObject,
  buildStepObject,
  releaseAttachedRuns,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { StatusManager } from './StatusManager.js'
import {
  CLEARED_TRANSACTION_FIELDS,
  hasOpenTransaction,
} from './transactionState.js'

// Note: using structuredClone when passing objects to the StatusManager shall make sure that we are not facing any unknown call-by-reference-issues anymore

describe('StatusManager', () => {
  let statusManager: StatusManager
  let updateRouteHookMock: Mock
  let route: Route
  let step: LiFiStepExtended

  const expectCallbacksToHaveBeenCalledWith = (route: Route) => {
    expect(updateRouteHookMock).toHaveBeenCalledWith(route)
  }

  const initializeStatusManager = ({
    includingExecution,
  }: {
    includingExecution: boolean
  }): StatusManager => {
    step = buildStepObject({ includingExecution })
    route = buildRouteObject({ step })

    executionState.create({
      route,
      executionOptions: {
        updateRouteHook: updateRouteHookMock,
      },
    })

    return new StatusManager(route.id)
  }

  beforeEach(() => {
    updateRouteHookMock = vi.fn()
    vi.spyOn(Date, 'now').mockImplementation(() => SOME_DATE)
  })

  describe('initializeExecution', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
        statusManager.initializeExecution(step)
      })

      it('should create an empty execution & call the callbacks with the updated route', () => {
        const updatedStep = Object.assign({}, step, {
          execution: {
            status: 'PENDING',
            actions: [],
            startedAt: SOME_DATE,
          },
        })

        const updatedRoute = Object.assign({}, route, {
          steps: [updatedStep],
        })

        expectCallbacksToHaveBeenCalledWith(updatedRoute)
      })
    })

    describe('when an execution is already defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.initializeExecution(structuredClone(step))
      })

      it('should not call the callbacks', () => {
        expect(updateRouteHookMock).not.toHaveBeenCalled()
      })
    })
  })

  describe('updateExecution', () => {
    beforeEach(() => {
      vi.spyOn(Date, 'now').mockImplementation(() => SOME_DATE + 10)
    })
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        // function has to be wrapped into a function https://jestjs.io/docs/expect#tothrowerror
        expect(() =>
          statusManager.updateExecution(structuredClone(step), {
            status: 'DONE',
          })
        ).toThrow("Can't update empty execution.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.updateExecution(structuredClone(step), {
          status: 'DONE',
          fromAmount: '123',
          toAmount: '312',
        })
      })

      it('should update the execution & call the callbacks with the updated route', () => {
        const updatedExecution = Object.assign({}, step.execution, {
          fromAmount: '123',
          toAmount: '312',
          status: 'DONE',
        })

        const updatedStep = Object.assign({}, step, {
          execution: updatedExecution,
        })

        const updatedRoute = Object.assign({}, route, {
          steps: [updatedStep],
        })

        expectCallbacksToHaveBeenCalledWith(updatedRoute)
      })
    })
  })

  describe('initializeAction', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.initializeAction({
            step: structuredClone(step),
            type: 'SWAP',
            chainId: 137,
            status: 'STARTED',
          })
        ).toThrow("Execution hasn't been initialized.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and the action already exists', () => {
        it('should update the action via updateAction and call the callbacks', () => {
          const action = statusManager.initializeAction({
            step: structuredClone(step),
            type: 'SET_ALLOWANCE',
            chainId: 137,
            status: 'PENDING',
          })

          expect(action.type).toEqual('SET_ALLOWANCE')
          expect(action.status).toEqual('PENDING')

          expect(updateRouteHookMock).toHaveBeenCalled()
        })
      })

      describe("and the action doesn't exist", () => {
        it('should create a new action and call the callbacks with the updated route', () => {
          const action = statusManager.initializeAction({
            step: structuredClone(step),
            type: 'CROSS_CHAIN',
            chainId: 137,
            status: 'STARTED',
          })

          expect(action.type).toEqual('CROSS_CHAIN')
          expect(action.status).toEqual('STARTED')
          expect(action.message).toEqual('Preparing bridge transaction')

          const updatedExecution = Object.assign({}, step.execution, {
            actions: [...step.execution!.actions, action],
          })

          const updatedStep = Object.assign({}, step, {
            execution: updatedExecution,
          })

          const updatedRoute = Object.assign({}, route, {
            steps: [updatedStep],
          })

          expectCallbacksToHaveBeenCalledWith(updatedRoute)
        })
      })
    })
  })

  describe('updateAction', () => {
    beforeEach(() => {
      statusManager = initializeStatusManager({ includingExecution: true })
    })

    describe('when no action can be found', () => {
      it('should throw an error', () => {
        expect(() =>
          statusManager.updateAction(
            structuredClone(step),
            'CROSS_CHAIN',
            'CANCELLED'
          )
        ).toThrow("Can't find an action for the given type.")
      })
    })

    describe('when a param is explicitly undefined', () => {
      it('clears the existing value rather than keeping it', () => {
        // `Object.assign` copies own enumerable keys whose value is
        // `undefined`, and callers rely on that to clear a field: the Solana
        // provider writes `txLink: undefined` alongside a fresh `txHash` so a
        // restarted PENDING action cannot show the previous run's explorer
        // link next to this run's signature. Swapping the merge for one that
        // skips undefined would silently strand that stale link, and nothing
        // in the provider's own suite would notice.
        const target = structuredClone(step)
        statusManager.updateAction(target, 'SWAP', 'PENDING', {
          txHash: 'old-hash',
          txLink: 'https://explorer/tx/old-hash',
        })

        const action = statusManager.updateAction(target, 'SWAP', 'PENDING', {
          txHash: 'new-hash',
          txLink: undefined,
        })

        expect(action.txHash).toEqual('new-hash')
        expect(action.txLink).toBeUndefined()
        expect('txLink' in action).toBe(true)
      })
    })

    describe('when an action is found', () => {
      const statuses = [
        { status: 'ACTION_REQUIRED' },
        { status: 'PENDING' },
        { status: 'FAILED' },
        { status: 'DONE' },
        { status: 'CANCELLED' },
      ]
      for (const { status } of statuses) {
        describe(`and the status is ${status}`, () => {
          it('should update the action and call the callbacks', () => {
            const action = statusManager.updateAction(
              structuredClone(step),
              'SWAP',
              status as ExecutionActionStatus
            )

            expect(action.type).toEqual('SWAP')
            expect(action.status).toEqual(status)
            // expect(action.message).toEqual(
            //   getActionMessage('SWAP', status as Status)
            // )

            const notUpdateableStatus =
              status === 'DONE' || status === 'CANCELLED'
            const updatedExecution = Object.assign({}, step.execution, {
              actions: [step.execution!.actions[0], action],
              status: notUpdateableStatus
                ? step.execution!.status
                : (status as ExecutionStatus),
            })

            const updatedStep = { ...step, execution: updatedExecution }

            const updatedRoute = Object.assign({}, route, {
              steps: [updatedStep],
            })

            expectCallbacksToHaveBeenCalledWith(updatedRoute)
          })
        })
      }
    })
  })

  describe('initializeExecution after a FAILED execution', () => {
    it('keeps signedAt while a tx action has an open transaction', () => {
      statusManager = initializeStatusManager({ includingExecution: true })
      step.execution!.status = 'FAILED'
      step.execution!.signedAt = 1234
      const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
      swap.txHash = '0xswap'

      statusManager.initializeExecution(step)

      expect(step.execution!.status).toBe('PENDING')
      expect(step.execution!.signedAt).toBe(1234)
    })

    it('clears signedAt when no tx action has an open transaction', () => {
      statusManager = initializeStatusManager({ includingExecution: true })
      step.execution!.status = 'FAILED'
      step.execution!.signedAt = 1234

      statusManager.initializeExecution(step)

      expect(step.execution!.signedAt).toBeUndefined()
    })
  })

  describe('initializeAction on an existing action', () => {
    it('clears the transaction fields of a final-failed action', () => {
      statusManager = initializeStatusManager({ includingExecution: true })
      const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
      Object.assign(swap, {
        status: 'FAILED',
        txHash: '0xold',
        txLink: 'https://explorer/tx/0xold',
        txHex: 'AQID',
        taskId: 'task-old',
        txFinal: true,
      })

      const action = statusManager.initializeAction({
        step,
        type: 'SWAP',
        chainId: 137,
        status: 'STARTED',
      })

      expect(action.status).toBe('STARTED')
      expect(action.txHash).toBeUndefined()
      expect(action.txLink).toBeUndefined()
      expect(action.txHex).toBeUndefined()
      expect(action.taskId).toBeUndefined()
      expect(action.txFinal).toBeUndefined()
    })

    it('keeps the hash of an action with an unknown outcome', () => {
      statusManager = initializeStatusManager({ includingExecution: true })
      const swap = step.execution!.actions.find((a) => a.type === 'SWAP')!
      Object.assign(swap, { status: 'PENDING', txHash: '0xopen' })

      const action = statusManager.initializeAction({
        step,
        type: 'SWAP',
        chainId: 137,
        status: 'PENDING',
      })

      expect(action.txHash).toBe('0xopen')
    })
  })
})

describe('StatusManager after stopRouteExecution', () => {
  const LATE_WRITE = {
    ...CLEARED_TRANSACTION_FIELDS,
    txHash: '0xlate',
    txLink: 'https://explorer/tx/0xlate',
    signedAt: SOME_DATE + 5,
  }

  // Each hook call is recorded as a copy taken at call time, the way the
  // widget's store keeps it: the route object changes after the call.
  let keptHook: Mock
  let keptRoutes: Route[]
  let liveHook: Mock
  let liveRoutes: Route[]

  /**
   * An execution with one running executor, as `executeSteps` leaves it.
   * `swap` is merged into its SWAP action first (an earlier transaction).
   */
  const startOldExecution = (
    options: { withHook?: boolean; swap?: Partial<ExecutionAction> } = {}
  ): { route: Route; step: LiFiStepExtended; statusManager: StatusManager } => {
    const step = buildStepObject({ includingExecution: true })
    Object.assign(
      step.execution!.actions.find((action) => action.type === 'SWAP')!,
      options.swap
    )
    const route = buildRouteObject({ step })
    executionState.create({
      route,
      executionOptions:
        options.withHook === false ? {} : { updateRouteHook: keptHook },
    })
    const statusManager = new StatusManager(route.id)
    attachStatusManager(route.id, statusManager)
    return { route, step, statusManager }
  }

  /** A newer execution of the same route id, as `resumeRoute` registers it. */
  const startLiveExecution = (liveStep: LiFiStepExtended): Route => {
    const liveRoute = buildRouteObject({ step: liveStep })
    executionState.create({
      route: liveRoute,
      executionOptions: { updateRouteHook: liveHook },
    })
    return liveRoute
  }

  /** A live step whose SWAP action is `swap`, or that has no SWAP action. */
  const liveStepWith = (
    swap: Partial<ExecutionAction> | undefined
  ): LiFiStepExtended => {
    const liveStep = buildStepObject({ includingExecution: true })
    const others = liveStep.execution!.actions.filter(
      (action) => action.type !== 'SWAP'
    )
    liveStep.execution!.actions = swap
      ? [...others, { type: 'SWAP', status: 'STARTED', ...swap }]
      : others
    return liveStep
  }

  const executionOf = (route: Route) =>
    (route.steps[0] as LiFiStepExtended).execution

  const swapOf = (route: Route): ExecutionAction | undefined =>
    executionOf(route)?.actions.find((action) => action.type === 'SWAP')

  beforeEach(() => {
    executionState.delete(buildRouteObject({}).id)
    keptRoutes = []
    keptHook = vi.fn((route: Route) => {
      keptRoutes.push(structuredClone(route))
    })
    liveRoutes = []
    liveHook = vi.fn((route: Route) => {
      liveRoutes.push(structuredClone(route))
    })
    vi.spyOn(Date, 'now').mockImplementation(() => SOME_DATE)
  })

  afterEach(() => {
    releaseAttachedRuns()
    executionState.delete(buildRouteObject({}).id)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  describe('without a newer execution of the route', () => {
    it('calls the kept hook with the kept route for a late txHash write', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      expect(keptHook).toHaveBeenCalledTimes(1)
      expect(keptHook.mock.calls[0][0]).toBe(route)
      expect(swapOf(keptRoutes[0])?.txHash).toBe('0xlate')
      expect(swapOf(keptRoutes[0])?.status).toBe('PENDING')
      expect(executionOf(keptRoutes[0])?.signedAt).toBe(SOME_DATE + 5)
    })

    it.each([
      {
        name: 'a clearing write',
        status: 'PENDING',
        params: { ...CLEARED_TRANSACTION_FIELDS },
      },
      {
        name: 'FAILED with txFinal',
        status: 'FAILED',
        params: {
          error: { code: 1003, message: 'Transaction was reverted.' },
          txFinal: true,
        },
      },
    ] as {
      name: string
      status: ExecutionActionStatus
      params: Partial<ExecutionAction>
    }[])('delivers $name to the kept hook', ({ status, params }) => {
      const { route, step, statusManager } = startOldExecution({
        swap: { txHash: '0xold', txLink: 'https://explorer/tx/0xold' },
      })
      stopRouteExecution(route)

      statusManager.updateAction(step, 'SWAP', status, params)

      expect(keptHook).toHaveBeenCalledTimes(1)
      expect(swapOf(keptRoutes[0])?.status).toBe(status)
    })

    it.each([
      {
        name: 'a status-only write',
        status: 'ACTION_REQUIRED',
        params: undefined,
      },
      {
        name: 'FAILED without txFinal',
        status: 'FAILED',
        params: {
          error: { code: 1003, message: 'Transaction confirmation timeout.' },
        },
      },
      {
        name: 'a message write',
        status: 'PENDING',
        params: {
          substatus: 'WAIT_DESTINATION_TRANSACTION',
          substatusMessage: 'Waiting for the destination chain.',
        },
      },
      {
        name: 'a signedAt-only write',
        status: 'PENDING',
        params: { signedAt: SOME_DATE + 7 },
      },
      {
        name: 'a clearing write over no transaction',
        status: 'PENDING',
        params: { ...CLEARED_TRANSACTION_FIELDS, signedAt: SOME_DATE + 7 },
      },
    ] as {
      name: string
      status: ExecutionActionStatus
      params: Partial<ExecutionAction & { signedAt: number }> | undefined
    }[])('keeps $name suppressed', ({ status, params }) => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)

      statusManager.updateAction(step, 'SWAP', status, params)

      expect(keptHook).not.toHaveBeenCalled()
    })

    it('ignores repeated txLink-only writes and calls the kept hook once for a txHash change', () => {
      const { route, step, statusManager } = startOldExecution({
        swap: { txHash: '0xold' },
      })
      stopRouteExecution(route)

      // The status poll rewrites the explorer link on every poll.
      for (const poll of [1, 2, 3]) {
        statusManager.updateAction(step, 'SWAP', 'PENDING', {
          txLink: `https://explorer.li.fi/tx/0xold?poll=${poll}`,
        })
      }
      // The same hash again is no change either.
      statusManager.updateAction(step, 'SWAP', 'PENDING', {
        txHash: '0xold',
        txLink: 'https://explorer/tx/0xold',
      })
      expect(keptHook).not.toHaveBeenCalled()

      statusManager.updateAction(step, 'SWAP', 'PENDING', {
        txHash: '0xreplaced',
        txLink: 'https://explorer/tx/0xreplaced',
      })

      expect(keptHook).toHaveBeenCalledTimes(1)
      expect(swapOf(keptRoutes[0])?.txHash).toBe('0xreplaced')
      expect(swapOf(keptRoutes[0])?.txLink).toBe(
        'https://explorer/tx/0xreplaced'
      )
    })

    it('keeps a new action and an execution update suppressed', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)

      statusManager.createAction({
        step,
        type: 'RECEIVING_CHAIN',
        chainId: 137,
        status: 'PENDING',
      })
      statusManager.updateExecution(step, { status: 'DONE' })

      expect(keptHook).not.toHaveBeenCalled()
    })

    it('does not throw into the task when the kept hook throws', () => {
      const { route, step, statusManager } = startOldExecution()
      keptHook.mockImplementation(() => {
        throw new Error('Storage is full.')
      })
      stopRouteExecution(route)

      expect(() =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      ).not.toThrow()
      expect(keptHook).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['reports', 'development', 1],
      ['does not report', 'production', 0],
    ])('%s the error of a kept hook that throws in %s', (_, env, reports) => {
      vi.stubEnv('NODE_ENV', env)
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
      const hookError = new Error('Storage is full.')
      const { route, step, statusManager } = startOldExecution()
      keptHook.mockImplementation(() => {
        throw hookError
      })
      stopRouteExecution(route)

      expect(() =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      ).not.toThrow()
      expect(debug).toHaveBeenCalledTimes(reports)
      if (reports) {
        expect(debug).toHaveBeenCalledWith(expect.any(String), hookError)
      }
    })

    it('does not throw into the task when no hook was configured', () => {
      const { route, step, statusManager } = startOldExecution({
        withHook: false,
      })
      stopRouteExecution(route)

      expect(() =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      ).not.toThrow()
    })
  })

  describe('with a newer execution of the same route id', () => {
    it('copies all five transaction fields, txType and signedAt into a live action without a transaction', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution(
        liveStepWith({
          status: 'STARTED',
          txLink: 'https://explorer/tx/stale',
          txType: 'standard',
        })
      )

      statusManager.updateAction(step, 'SWAP', 'PENDING', {
        ...CLEARED_TRANSACTION_FIELDS,
        txHash: '0xlate',
        txHex: 'AQID',
        taskId: 'task-late',
        txType: 'relayed',
        signedAt: SOME_DATE + 5,
      })

      const live = swapOf(liveRoute)!
      expect(live.txHash).toBe('0xlate')
      expect(live.txHex).toBe('AQID')
      expect(live.taskId).toBe('task-late')
      // The live `txType` described no transaction; it must not label this one.
      expect(live.txType).toBe('relayed')
      expect('txLink' in live).toBe(true)
      expect(live.txLink).toBeUndefined()
      expect('txFinal' in live).toBe(true)
      expect(live.txFinal).toBeUndefined()
      expect(live.status).toBe('STARTED')
      expect(executionOf(liveRoute)?.signedAt).toBe(SOME_DATE + 5)
      expect(liveHook).toHaveBeenCalledTimes(1)
      expect(liveHook.mock.calls[0][0]).toBe(liveRoute)
      expect(swapOf(liveRoutes[0])?.txHash).toBe('0xlate')
      expect(keptHook).not.toHaveBeenCalled()
    })

    it('opens a live FAILED + txFinal action by removing txFinal', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution(
        liveStepWith({ status: 'FAILED', txHash: '0xdead', txFinal: true })
      )

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      const live = swapOf(liveRoute)!
      expect(live.txHash).toBe('0xlate')
      expect('txFinal' in live).toBe(true)
      expect(live.txFinal).toBeUndefined()
      expect(live.status).toBe('FAILED')
      expect(hasOpenTransaction(live)).toBe(true)
      expect(liveHook).toHaveBeenCalledTimes(1)
    })

    it('changes nothing in a live PENDING action for a late FAILED + txFinal write', () => {
      const { route, step, statusManager } = startOldExecution()
      // Written while the old execution still ran.
      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      stopRouteExecution(route)
      keptHook.mockClear()
      const liveRoute = startLiveExecution(liveStepWith({ status: 'PENDING' }))
      const before = structuredClone(executionOf(liveRoute))

      statusManager.updateAction(step, 'SWAP', 'FAILED', {
        error: { code: 1003, message: 'Transaction was reverted.' },
        txFinal: true,
      })

      expect(executionOf(liveRoute)).toEqual(before)
      expect(liveHook).not.toHaveBeenCalled()
      expect(keptHook).not.toHaveBeenCalled()
    })

    it('adds a copy of the late action when the live step has none of its type', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution(liveStepWith(undefined))

      const late = statusManager.updateAction(
        step,
        'SWAP',
        'PENDING',
        LATE_WRITE
      )

      const live = swapOf(liveRoute)!
      expect(live).not.toBe(late)
      expect(live.txHash).toBe('0xlate')
      expect(live.status).toBe('PENDING')
      expect(executionOf(liveRoute)?.signedAt).toBe(SOME_DATE + 5)
      expect(liveHook).toHaveBeenCalledTimes(1)

      // Later status writes of the old task stay out of the live route.
      statusManager.updateAction(step, 'SWAP', 'DONE')
      expect(swapOf(liveRoute)?.status).toBe('PENDING')
    })

    it('creates the execution of a live step that has not started, and the new executor reuses it', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveStep = buildStepObject({ includingExecution: false })
      startLiveExecution(liveStep)

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      expect(liveStep.execution?.status).toBe('PENDING')
      expect(liveStep.execution?.signedAt).toBe(SOME_DATE + 5)
      expect(liveStep.execution?.actions.map((a) => a.type)).toEqual(['SWAP'])
      expect(liveHook).toHaveBeenCalledTimes(1)

      const liveStatusManager = new StatusManager(route.id)
      const execution = liveStatusManager.initializeExecution(liveStep)
      const action = liveStatusManager.initializeAction({
        step: liveStep,
        type: 'SWAP',
        chainId: 137,
        status: 'STARTED',
      })
      expect(execution.actions).toHaveLength(1)
      expect(action.txHash).toBe('0xlate')
    })

    it('leaves a live action with an open transaction unchanged', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution(
        liveStepWith({ status: 'PENDING', txHash: '0xlive' })
      )

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      expect(swapOf(liveRoute)?.txHash).toBe('0xlive')
      expect(liveHook).not.toHaveBeenCalled()
      expect(keptHook).not.toHaveBeenCalled()
    })

    it('merges nothing and does not throw when the live route has no step of that id', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution({
        ...liveStepWith({ status: 'STARTED' }),
        id: 're-quoted-step',
      })

      expect(() =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      ).not.toThrow()

      expect(swapOf(liveRoute)?.txHash).toBeUndefined()
      expect(liveHook).not.toHaveBeenCalled()
      expect(keptHook).not.toHaveBeenCalled()
    })

    it('does not throw into the old task when the live hook throws', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = startLiveExecution(liveStepWith({ status: 'STARTED' }))
      liveHook.mockImplementation(() => {
        throw new Error('Storage is full.')
      })

      expect(() =>
        statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)
      ).not.toThrow()
      expect(swapOf(liveRoute)?.txHash).toBe('0xlate')
      expect(liveHook).toHaveBeenCalledTimes(1)
    })

    // `signedAt` is merged only from a SWAP / CROSS_CHAIN late action, and
    // only when it is defined.
    it.each([
      {
        name: 'a late SET_ALLOWANCE transaction',
        type: 'SET_ALLOWANCE',
        oldSignedAt: SOME_DATE + 5,
        params: {
          txHash: '0xapprove',
          txLink: 'https://explorer/tx/0xapprove',
        },
      },
      {
        name: 'a late SWAP transaction without signedAt',
        type: 'SWAP',
        oldSignedAt: undefined,
        params: { ...CLEARED_TRANSACTION_FIELDS, txHash: '0xlate' },
      },
    ] as {
      name: string
      type: ExecutionActionType
      oldSignedAt: number | undefined
      params: Partial<ExecutionAction>
    }[])(
      'keeps the live signedAt for $name',
      ({ type, oldSignedAt, params }) => {
        const { route, step, statusManager } = startOldExecution()
        step.execution!.signedAt = oldSignedAt
        stopRouteExecution(route)
        // Only a SWAP action without a transaction, so the write is merged.
        const liveStep = buildStepObject({ includingExecution: true })
        liveStep.execution!.actions = [{ type: 'SWAP', status: 'STARTED' }]
        liveStep.execution!.signedAt = SOME_DATE + 9
        const liveRoute = startLiveExecution(liveStep)

        statusManager.updateAction(step, type, 'PENDING', params)

        expect(liveHook).toHaveBeenCalledTimes(1)
        expect(
          executionOf(liveRoute)?.actions.find((action) => action.type === type)
            ?.txHash
        ).toBe(params.txHash)
        expect(executionOf(liveRoute)?.signedAt).toBe(SOME_DATE + 9)
      }
    )
  })

  describe('with a newer execution that ended since the stop', () => {
    /** A newer execution of the route id that started and ended. */
    const endLiveExecution = (liveStep: LiFiStepExtended): Route => {
      const liveRoute = startLiveExecution(liveStep)
      executionState.delete(liveRoute.id)
      return liveRoute
    }

    it('merges the late transaction into the route of the newer execution and calls its hook', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = endLiveExecution(liveStepWith({ status: 'FAILED' }))

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      const live = swapOf(liveRoute)!
      expect(live.txHash).toBe('0xlate')
      expect(live.status).toBe('FAILED')
      expect(hasOpenTransaction(live)).toBe(true)
      expect(executionOf(liveRoute)?.signedAt).toBe(SOME_DATE + 5)
      expect(liveHook).toHaveBeenCalledTimes(1)
      expect(liveHook.mock.calls[0][0]).toBe(liveRoute)
      expect(swapOf(liveRoutes[0])?.txHash).toBe('0xlate')
      expect(keptHook).not.toHaveBeenCalled()
    })

    it('leaves the route of the newer execution unchanged when its action is open', () => {
      const { route, step, statusManager } = startOldExecution()
      stopRouteExecution(route)
      const liveRoute = endLiveExecution(
        liveStepWith({ status: 'PENDING', txHash: '0xlive' })
      )
      const before = structuredClone(executionOf(liveRoute))

      statusManager.updateAction(step, 'SWAP', 'PENDING', LATE_WRITE)

      expect(executionOf(liveRoute)).toEqual(before)
      expect(liveHook).not.toHaveBeenCalled()
      expect(keptHook).not.toHaveBeenCalled()
    })
  })
})

// Every write of transaction data in core and the six providers goes
// through `updateAction`. These are the shapes of those writes at 21a1bc2b, each on the action state it meets in the task;
// every one that changes the transaction reaches the kept hook after a stop.
// A write that bypasses `updateAction` is not delivered after a stop.
describe('provider writes of transaction data after stopRouteExecution', () => {
  const routeId = buildRouteObject({}).id

  beforeEach(() => {
    executionState.delete(routeId)
  })

  afterEach(() => {
    releaseAttachedRuns()
    executionState.delete(routeId)
  })

  it.each([
    {
      site: 'Ethereum standard sign (new hash)',
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        ...CLEARED_TRANSACTION_FIELDS,
        txHash: '0xhash',
        txLink: 'https://explorer/tx/0xhash',
        txType: 'standard',
        signedAt: SOME_DATE,
      },
    },
    {
      site: 'Ethereum relayed sign (task id)',
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        ...CLEARED_TRANSACTION_FIELDS,
        taskId: '0xtask',
        txType: 'relayed',
        txLink: 'https://relayer/task',
        signedAt: SOME_DATE,
      },
    },
    {
      site: 'Ethereum batched sign (batch id)',
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        ...CLEARED_TRANSACTION_FIELDS,
        taskId: '0xbatch',
        txType: 'batched',
        signedAt: SOME_DATE,
      },
    },
    {
      site: 'Solana sign (clear before decode)',
      before: { status: 'FAILED', txHash: '0xold', txFinal: true },
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: { ...CLEARED_TRANSACTION_FIELDS, signedAt: SOME_DATE },
    },
    {
      site: 'Solana sign (stored bytes)',
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: { txHex: 'AQID' },
    },
    {
      site: 'Tron and Sui sign (stored bytes)',
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        ...CLEARED_TRANSACTION_FIELDS,
        txHex: '{}',
        signedAt: SOME_DATE,
      },
    },
    {
      site: 'Solana and Tron confirmation (hash, bytes dropped)',
      before: { txHex: 'AQID' },
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        txHash: '0xhash',
        txLink: 'https://explorer/tx/0xhash',
        txHex: undefined,
      },
    },
    {
      site: 'Solana, Sui and Tron (bytes dropped)',
      before: { txHash: '0xhash', txHex: 'AQID' },
      calls: 1,
      type: 'SWAP',
      status: 'PENDING',
      params: { txHex: undefined },
    },
    {
      site: 'core status poll (explorer link only)',
      before: { txHash: '0xhash' },
      calls: 0,
      type: 'SWAP',
      status: 'PENDING',
      params: {
        substatus: 'WAIT_DESTINATION_TRANSACTION',
        substatusMessage: 'Waiting for the destination chain.',
        txLink: 'https://explorer.li.fi/tx/0xhash',
      },
    },
    {
      site: 'core status DONE (receiving hash)',
      before: { txHash: '0xsending' },
      calls: 1,
      type: 'SWAP',
      status: 'DONE',
      params: {
        chainId: 137,
        txHash: '0xreceiving',
        txLink: 'https://explorer/tx/0xreceiving',
      },
    },
    {
      site: 'Ethereum and Stellar allowance (clear)',
      calls: 1,
      type: 'SET_ALLOWANCE',
      status: 'ACTION_REQUIRED',
      params: { txHash: undefined, txLink: undefined },
    },
    {
      site: 'Ethereum and Tron allowance (approval hash)',
      calls: 1,
      type: 'SET_ALLOWANCE',
      status: 'PENDING',
      params: { txHash: '0xapprove', txLink: 'https://explorer/tx/0xapprove' },
    },
  ] as {
    site: string
    before?: Partial<ExecutionAction>
    calls: number
    type: ExecutionActionType
    status: ExecutionActionStatus
    params: Partial<ExecutionAction & { signedAt: number }>
  }[])(
    'the write of $site calls the kept hook $calls time(s)',
    ({ before, calls, type, status, params }) => {
      const step = buildStepObject({ includingExecution: true })
      Object.assign(
        step.execution!.actions.find((action) => action.type === type)!,
        before
      )
      const route = buildRouteObject({ step })
      const hook = vi.fn()
      executionState.create({
        route,
        executionOptions: { updateRouteHook: hook },
      })
      const statusManager = new StatusManager(route.id)
      attachStatusManager(route.id, statusManager)
      stopRouteExecution(route)

      statusManager.updateAction(step, type, status, params)

      expect(hook).toHaveBeenCalledTimes(calls)
      for (const [delivered] of hook.mock.calls) {
        expect(delivered).toBe(route)
      }
    }
  )
})
