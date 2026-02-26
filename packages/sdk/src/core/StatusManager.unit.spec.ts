import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExecutionActionStatus,
  ExecutionStatus,
  LiFiStepExtended,
} from '../types/core.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
import { StatusManager } from './StatusManager.js'

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
            lastActionType: 'CROSS_CHAIN',
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
              lastActionType: 'SWAP',
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
})
