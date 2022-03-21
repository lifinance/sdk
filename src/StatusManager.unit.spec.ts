import { buildRouteObject, buildStepObject } from '../test/fixtures'
import StatusManager from './StatusManager'
import { Route, Status, Step } from './types'
import { deepClone } from './utils/utils'

// Note: using `deepClone` when passing objects to the StatusManager shall make sure that we are not facing any unknown call-by-reference-issues anymore

describe('StatusManager', () => {
  let statusManager: StatusManager
  let internalUpdateRouteCallbackMock: jest.Mock
  let updateCallbackMock: jest.Mock
  let route: Route
  let step: Step

  const expectCallbacksToHaveBeenCalledWith = (route: Route) => {
    expect(updateCallbackMock).toHaveBeenCalledWith(route)
    expect(internalUpdateRouteCallbackMock).toHaveBeenCalledWith(route)
  }

  const initializeStatusManager = ({
    includingExecution,
  }: {
    includingExecution: boolean
  }): StatusManager => {
    step = buildStepObject({ includingExecution })
    route = buildRouteObject({ step })

    return new StatusManager(
      deepClone(route),
      {
        updateCallback: updateCallbackMock,
        switchChainHook: () => Promise.resolve(undefined),
        infiniteApproval: false,
      },
      internalUpdateRouteCallbackMock
    )
  }

  beforeEach(() => {
    internalUpdateRouteCallbackMock = jest.fn()
    updateCallbackMock = jest.fn()
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
            status: 'NOT_STARTED',
            process: [],
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
        statusManager.initExecutionObject(deepClone(step))
      })

      it('should not call the callbacks', () => {
        expect(updateCallbackMock).not.toHaveBeenCalled()
        expect(internalUpdateRouteCallbackMock).not.toHaveBeenCalled()
      })
    })
  })

  describe('updateExecution', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        // function has to be wrapped into a function https://jestjs.io/docs/expect#tothrowerror
        expect(() =>
          statusManager.updateExecution(deepClone(step), 'DONE')
        ).toThrow("Can't update empty execution")
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.updateExecution(deepClone(step), 'DONE', {
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
          statusManager.findOrCreateProcess(
            'newProcessId',
            deepClone(step),
            'New Process Message'
          )
        ).toThrow('Execution has not been initialized')
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and the process already exists', () => {
        it('should return the process and not call the callbacks', () => {
          const process = statusManager.findOrCreateProcess(
            'process1',
            deepClone(step),
            'some message'
          )

          expect(process).toEqual(step.execution?.process[0])

          expect(updateCallbackMock).not.toHaveBeenCalled()
          expect(internalUpdateRouteCallbackMock).not.toHaveBeenCalled()
        })
      })

      describe("and the process doesn't exist", () => {
        it('should create a process and call the callbacks with the updated route', () => {
          const process = statusManager.findOrCreateProcess(
            'process3',
            deepClone(step),
            'some message',
            {
              errorMessage: 'Some error',
              someParameter: 'Some value',
            }
          )

          expect(process.id).toEqual('process3')
          expect(process.status).toEqual('PENDING')
          expect(process.message).toEqual('some message')

          const updatedExecution = Object.assign({}, step.execution, {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
            deepClone(step),
            'unknownProcessId',
            'CANCELLED'
          )
        ).toThrow('Cannot find process for given id')
      })
    })

    describe('when a process is found', () => {
      ;[
        {
          status: 'ACTION_REQUIRED',
          message: 'Sign Transaction',
        },
        {
          status: 'CHAIN_SWITCH_REQUIRED',
          message: 'Switching Chain',
        },
        { status: 'PENDING', message: 'Wait for' },
        {
          status: 'FAILED',
          doneAt: true,
        },
        { status: 'DONE', doneAt: true },
        { status: 'RESUME' },
        {
          status: 'CANCELLED',
          message: 'CANCELLED - Funds have been refunded on source chain.',
          doneAt: true,
        },
      ].forEach(({ status, message, doneAt }) => {
        describe(`and the status is ${status}`, () => {
          it('should update the process and call the callbacks', () => {
            const process = statusManager.updateProcess(
              deepClone(step),
              'process2',
              status as Status,
              { anotherMessage: 'Should be updated in the process' }
            )

            expect(process.id).toEqual('process2')
            expect(process.status).toEqual(status)
            message && expect(process.message).toEqual(message)
            doneAt
              ? expect(process.doneAt).toBeDefined()
              : expect(process.doneAt).toBeUndefined()

            const updatedExecution = Object.assign({}, step.execution, {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              process: [step.execution!.process[0], process],
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
  })

  describe('removeProcess', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw an error', () => {
        expect(() =>
          statusManager.removeProcess(deepClone(step), 'unkownProcessId')
        ).toThrow('Execution has not been initialized')
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
        statusManager.removeProcess(deepClone(step), 'process1')
      })

      it('should remove the process and call the callbacks', () => {
        const updatedExecution = Object.assign({}, step.execution, {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
