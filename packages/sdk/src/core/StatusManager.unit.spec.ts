import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiFiStepExtended, Transaction } from '../types/core.js'
import {
  buildRouteObject,
  buildStepObject,
  SOME_DATE,
} from './execution.unit.mock.js'
import { executionState } from './executionState.js'
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

  describe('updateExecution', () => {
    describe('when no execution is defined yet', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: false })
      })

      it('should create execution when type is provided', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'SWAP',
          status: 'PENDING',
          startedAt: Date.now(),
          transactions: [],
        })

        expect(result.execution!.status).toBe('PENDING')
        expect(result.execution!.type).toBe('SWAP')
        expect(result.execution!.startedAt).toBe(SOME_DATE)
        expect(result.execution!.transactions).toEqual([])
        expect(updateRouteHookMock).toHaveBeenCalled()
      })

      it('should create execution with the new type and chainId', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'SWAP',
          chainId: 137,
          status: 'PENDING',
          startedAt: Date.now(),
          transactions: [],
        })

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

      describe('and updating status', () => {
        it('should update the status and call the callbacks', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'DONE',
            doneAt: Date.now(),
          })

          expect(result.execution!.status).toBe('DONE')
          expect(result.execution!.doneAt).toBe(SOME_DATE)
          expect(updateRouteHookMock).toHaveBeenCalled()
        })

        it('should update additional execution properties when provided', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'DONE',
            fromAmount: '123',
            toAmount: '456',
          })

          expect(result.execution!.status).toBe('DONE')
          expect(result.execution!.fromAmount).toBe('123')
          expect(result.execution!.toAmount).toBe('456')
        })

        it('should update a transaction when provided', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'DONE',
            transaction: {
              type: 'SWAP',
              txHash: '0xabc123',
              txLink: 'https://example.com/tx/0xabc123',
            },
          })

          expect(result.execution!.status).toBe('DONE')
          const swapTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'SWAP'
          )
          expect(swapTx?.txHash).toBe('0xabc123')
        })

        it('should add a new transaction after type transition', () => {
          // First transition to RECEIVING_CHAIN type
          const clonedStep = structuredClone(step)
          const stepWithNewType = statusManager.updateExecution(clonedStep, {
            type: 'RECEIVING_CHAIN',
            chainId: 42161,
            status: 'PENDING',
          })

          const result = statusManager.updateExecution(stepWithNewType, {
            type: 'RECEIVING_CHAIN',
            status: 'DONE',
            transaction: {
              type: 'RECEIVING_CHAIN',
              txHash: '0xdef456',
              txLink: 'https://example.com/tx/0xdef456',
            },
          })

          expect(result.execution!.status).toBe('DONE')
          const receivingTx = result.execution!.transactions.find(
            (t: Transaction) => t.type === 'RECEIVING_CHAIN'
          )
          expect(receivingTx?.txHash).toBe('0xdef456')
        })

        it('should remove a transaction when filtered transactions array is provided', () => {
          const clonedStep = structuredClone(step)
          // Verify SWAP transaction exists before removal
          expect(
            clonedStep.execution!.transactions.find(
              (t: Transaction) => t.type === 'SWAP'
            )
          ).toBeDefined()

          const result = statusManager.updateExecution(clonedStep, {
            type: 'SWAP',
            status: 'PENDING',
            transactions: clonedStep.execution!.transactions.filter(
              (t: Transaction) => t.type !== 'SWAP'
            ),
          })

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

      describe('and transitioning to the same status', () => {
        it('should still update and call updateStepInRoute', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'PENDING',
          })

          expect(result.execution!.status).toBe('PENDING')
          expect(updateRouteHookMock).toHaveBeenCalled()
        })

        it('should apply execution updates when provided', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'PENDING',
            fromAmount: '555',
          })

          expect(result.execution!.status).toBe('PENDING')
          expect(result.execution!.fromAmount).toBe('555')
          expect(updateRouteHookMock).toHaveBeenCalled()
        })
      })

      describe('and updating type', () => {
        it('should update the type and chainId', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'RECEIVING_CHAIN',
            chainId: 42161,
            status: 'PENDING',
          })

          expect(result.execution!.type).toBe('RECEIVING_CHAIN')
          expect(result.execution!.chainId).toBe(42161)
          expect(updateRouteHookMock).toHaveBeenCalled()
        })
      })

      describe('and updating with additional properties', () => {
        it('should update execution properties along with status', () => {
          const result = statusManager.updateExecution(structuredClone(step), {
            type: 'SWAP',
            status: 'PENDING',
            fromAmount: '999',
          })

          expect(result.execution!.status).toBe('PENDING')
          expect(result.execution!.fromAmount).toBe('999')
          expect(updateRouteHookMock).toHaveBeenCalled()
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
