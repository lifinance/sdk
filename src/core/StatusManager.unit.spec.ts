import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from '../tests/fixtures.js'
import { executionState } from './executionState.js'
import { StatusManager } from './StatusManager.js'
import type {
  ExecutionStatus,
  LiFiStepExtended,
  ProcessStatus,
} from './types.js'

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
            process: [],
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
          statusManager.updateExecution(structuredClone(step), 'DONE')
        ).toThrow("Can't update empty execution.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.updateExecution(structuredClone(step), 'DONE', {
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

  describe('findOrCreateProcess', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.findOrCreateProcess({
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

      describe('and the process already exists', () => {
        it('should return the process and not call the callbacks', () => {
          const process = statusManager.findOrCreateProcess({
            step: structuredClone(step),
            type: 'TOKEN_ALLOWANCE',
          })

          expect(process).toEqual(step.execution?.process[0])

          expect(updateRouteHookMock).not.toHaveBeenCalled()
        })
      })

      describe("and the process doesn't exist", () => {
        it('should create a process and call the callbacks with the updated route', () => {
          const process = statusManager.findOrCreateProcess({
            step: structuredClone(step),
            type: 'CROSS_CHAIN',
          })

          expect(process.type).toEqual('CROSS_CHAIN')
          expect(process.status).toEqual('STARTED')
          expect(process.message).toEqual('Preparing bridge transaction')

          const updatedExecution = Object.assign({}, step.execution, {
            process: [...step.execution!.process, process],
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

  describe('updateProcess', () => {
    beforeEach(() => {
      statusManager = initializeStatusManager({ includingExecution: true })
    })

    describe('when no process can be found', () => {
      it('should throw an error', () => {
        expect(() =>
          statusManager.updateProcess(
            structuredClone(step),
            'CROSS_CHAIN',
            'CANCELLED'
          )
        ).toThrow("Can't find a process for the given type.")
      })
    })

    describe('when a process is found', () => {
      const statuses = [
        { status: 'ACTION_REQUIRED' },
        { status: 'PENDING' },
        { status: 'FAILED', doneAt: true },
        { status: 'DONE', doneAt: true },
        { status: 'CANCELLED', doneAt: true },
      ]
      for (const { status, doneAt } of statuses) {
        describe(`and the status is ${status}`, () => {
          it('should update the process and call the callbacks', () => {
            const process = statusManager.updateProcess(
              structuredClone(step),
              'SWAP',
              status as ProcessStatus
            )

            expect(process.type).toEqual('SWAP')
            expect(process.status).toEqual(status)
            // expect(process.message).toEqual(
            //   getProcessMessage('SWAP', status as Status)
            // )
            doneAt
              ? expect(process.doneAt).toBeDefined()
              : expect(process.doneAt).toBeUndefined()

            const notUpdateableStatus =
              status === 'DONE' || status === 'CANCELLED'
            const updatedExecution = Object.assign({}, step.execution, {
              process: [step.execution!.process[0], process],
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

  describe('removeProcess', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.removeProcess(structuredClone(step), 'TOKEN_ALLOWANCE')
        ).toThrow("Execution hasn't been initialized.")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.removeProcess(structuredClone(step), 'TOKEN_ALLOWANCE')
      })

      it('should remove the process and call the callbacks', () => {
        const updatedExecution = Object.assign({}, step.execution, {
          process: [step.execution!.process[1]],
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
