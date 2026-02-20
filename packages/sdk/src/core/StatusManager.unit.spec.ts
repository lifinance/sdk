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

  describe('initExecutionObject', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
        statusManager.initExecutionObject(step)
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
        statusManager.initExecutionObject(structuredClone(step))
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

  describe('findOrCreateAction', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.findOrCreateAction({
            step: structuredClone(step),
            type: 'SWAP',
          })
        ).toThrow("Execution hasn't been initialized.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and the action already exists', () => {
        it('should return the action and not call the callbacks', () => {
          const action = statusManager.findOrCreateAction({
            step: structuredClone(step),
            type: 'TOKEN_ALLOWANCE',
          })

          expect(action).toEqual(step.execution?.actions[0])

          expect(updateRouteHookMock).not.toHaveBeenCalled()
        })
      })

      describe("and the action doesn't exist", () => {
        it('should create a new action and call the callbacks with the updated route', () => {
          const action = statusManager.findOrCreateAction({
            step: structuredClone(step),
            type: 'CROSS_CHAIN',
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

  describe('removeAction', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.removeAction(structuredClone(step), 'TOKEN_ALLOWANCE')
        ).toThrow("Execution hasn't been initialized.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.removeAction(structuredClone(step), 'TOKEN_ALLOWANCE')
      })

      it('should remove the action and call the callbacks', () => {
        const updatedExecution = Object.assign({}, step.execution, {
          actions: [step.execution!.actions[1]],
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
