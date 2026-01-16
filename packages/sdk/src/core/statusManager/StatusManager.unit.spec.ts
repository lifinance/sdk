import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiFiStepExtended, Transaction } from '../../types/core.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from '../execution.unit.mock.js'
import { executionState } from '../executionState.js'
import { StatusManager } from './StatusManager.js'

describe('StatusManager', () => {
  let statusManager: StatusManager
  let updateRouteHookMock: Mock
  let route: Route
  let step: LiFiStepExtended

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

  describe('transitionExecutionStatus', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should throw when no type is provided in execution update', () => {
        expect(() =>
          statusManager.transitionExecutionStatus(
            structuredClone(step),
            'PENDING'
          )
        ).toThrow('Execution must have type to transition status')
      })

      it('should create execution when type is provided', () => {
        const result = statusManager.transitionExecutionStatus(
          structuredClone(step),
          'PENDING',
          { type: 'SWAP' }
        )

        expect(result.execution!.status).toBe('PENDING')
        expect(result.execution!.type).toBe('SWAP')
        expect(result.execution!.startedAt).toBe(SOME_DATE)
        expect(result.execution!.transactions).toEqual([])
        expect(updateRouteHookMock).toHaveBeenCalled()
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and transitioning to a valid status', () => {
        it('should update the status and call the callbacks', () => {
          // PENDING -> DONE is valid
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'DONE'
          )

          expect(result.execution!.status).toBe('DONE')
          expect(result.execution!.doneAt).toBe(SOME_DATE)
          expect(updateRouteHookMock).toHaveBeenCalled()
        })

        it('should update additional execution properties when provided', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'DONE',
            {
              fromAmount: '123',
              toAmount: '456',
            }
          )

          expect(result.execution!.status).toBe('DONE')
          expect(result.execution!.fromAmount).toBe('123')
          expect(result.execution!.toAmount).toBe('456')
        })

        it('should add a transaction when provided', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'DONE',
            {
              transaction: {
                txHash: '0xabc123',
                txLink: 'https://example.com/tx/0xabc123',
              },
            }
          )

          expect(result.execution!.status).toBe('DONE')
          // Should update existing SWAP transaction
          const swapTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'SWAP'
          )
          expect(swapTx?.txHash).toBe('0xabc123')
        })

        it('should add a new transaction after type transition', () => {
          // First transition to RECEIVING_CHAIN type
          const stepWithNewType = statusManager.transitionExecutionType(
            structuredClone(step),
            'RECEIVING_CHAIN',
            42161
          )

          const result = statusManager.transitionExecutionStatus(
            stepWithNewType,
            'DONE',
            {
              transaction: {
                txHash: '0xdef456',
                txLink: 'https://example.com/tx/0xdef456',
              },
            }
          )

          expect(result.execution!.status).toBe('DONE')
          const receivingTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'RECEIVING_CHAIN'
          )
          expect(receivingTx?.txHash).toBe('0xdef456')
        })

        it('should remove a transaction when null is provided', () => {
          const clonedStep = structuredClone(step)
          // Verify SWAP transaction exists before removal
          expect(
            clonedStep.execution!.transactions.find(
              (t: Transaction) => t.type === 'SWAP'
            )
          ).toBeDefined()

          const result = statusManager.transitionExecutionStatus(
            clonedStep,
            'PENDING',
            {
              transaction: null,
            }
          )

          // SWAP transaction should be removed
          const swapTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'SWAP'
          )
          expect(swapTx).toBeUndefined()

          // TOKEN_ALLOWANCE transaction should still exist
          const allowanceTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'TOKEN_ALLOWANCE'
          )
          expect(allowanceTx).toBeDefined()
        })
      })

      describe('and transitioning to an invalid status', () => {
        it('should throw an error', () => {
          // PENDING -> MESSAGE_REQUIRED is not valid in the transitions
          expect(() =>
            statusManager.transitionExecutionStatus(
              structuredClone(step),
              'MESSAGE_REQUIRED'
            )
          ).toThrow('Invalid transition: PENDING → MESSAGE_REQUIRED')
        })
      })

      describe('and transitioning to the same status', () => {
        it('should return early without calling updateStepInRoute when no execution update provided', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'PENDING'
          )

          expect(result.execution!.status).toBe('PENDING')
          expect(updateRouteHookMock).not.toHaveBeenCalled()
        })

        it('should still apply execution updates when provided', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'PENDING',
            { fromAmount: '555' }
          )

          expect(result.execution!.status).toBe('PENDING')
          expect(result.execution!.fromAmount).toBe('555')
          expect(updateRouteHookMock).toHaveBeenCalled()
        })
      })
    })
  })

  describe('transitionExecutionType', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should create execution with the new type', () => {
        const result = statusManager.transitionExecutionType(
          structuredClone(step),
          'SWAP',
          137
        )

        expect(result.execution!.type).toBe('SWAP')
        expect(result.execution!.chainId).toBe(137)
        expect(result.execution!.status).toBe('PENDING')
        expect(result.execution!.startedAt).toBe(SOME_DATE)
        expect(updateRouteHookMock).toHaveBeenCalled()
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and transitioning to a valid type', () => {
        it('should update the type and chainId', () => {
          // SWAP -> RECEIVING_CHAIN is valid
          const result = statusManager.transitionExecutionType(
            structuredClone(step),
            'RECEIVING_CHAIN',
            42161
          )

          expect(result.execution!.type).toBe('RECEIVING_CHAIN')
          expect(result.execution!.chainId).toBe(42161)
          expect(updateRouteHookMock).toHaveBeenCalled()
        })
      })

      describe('and transitioning to an invalid type', () => {
        it('should throw an error', () => {
          // SWAP -> TOKEN_ALLOWANCE is not valid
          expect(() =>
            statusManager.transitionExecutionType(
              structuredClone(step),
              'TOKEN_ALLOWANCE',
              137
            )
          ).toThrow('Invalid type transition: SWAP → TOKEN_ALLOWANCE')
        })
      })

      describe('and transitioning to the same type', () => {
        it('should return early without calling updateStepInRoute', () => {
          const result = statusManager.transitionExecutionType(
            structuredClone(step),
            'SWAP',
            137
          )

          expect(result.execution!.type).toBe('SWAP')
          expect(updateRouteHookMock).not.toHaveBeenCalled()
        })
      })
    })
  })

  describe('updateStepInRoute', () => {
    beforeEach(() => {
      statusManager = initializeStatusManager({ includingExecution: true })
    })

    it('should update the step in the route and call the callbacks', () => {
      const modifiedStep = structuredClone(step)
      modifiedStep.execution!.fromAmount = '999'

      statusManager.updateStepInRoute(modifiedStep)

      expect(updateRouteHookMock).toHaveBeenCalled()
      const calledRoute = updateRouteHookMock.mock.calls[0][0]
      expect(calledRoute.steps[0].execution.fromAmount).toBe('999')
    })
  })

  describe('allowUpdates', () => {
    beforeEach(() => {
      statusManager = initializeStatusManager({ includingExecution: true })
    })

    it('should prevent updates when set to false', () => {
      statusManager.allowUpdates(false)

      statusManager.updateStepInRoute(structuredClone(step))

      expect(updateRouteHookMock).not.toHaveBeenCalled()
    })

    it('should allow updates when set to true', () => {
      statusManager.allowUpdates(false)
      statusManager.allowUpdates(true)

      statusManager.updateStepInRoute(structuredClone(step))

      expect(updateRouteHookMock).toHaveBeenCalled()
    })
  })
})
