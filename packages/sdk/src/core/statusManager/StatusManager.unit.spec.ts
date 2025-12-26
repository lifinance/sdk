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

      it('should throw when no execution update is provided', () => {
        expect(() =>
          statusManager.transitionExecutionStatus(structuredClone(step), 'DONE')
        ).toThrow()
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
          ) as LiFiStepExtended

          expect(result.execution?.status).toBe('DONE')
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
          ) as LiFiStepExtended

          expect(result.execution?.status).toBe('DONE')
          expect(result.execution?.fromAmount).toBe('123')
          expect(result.execution?.toAmount).toBe('456')
        })

        it('should add a transaction when provided', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'DONE',
            {
              transaction: {
                type: 'SWAP',
                txHash: '0xabc123',
                txLink: 'https://example.com/tx/0xabc123',
              },
            }
          ) as LiFiStepExtended

          expect(result.execution?.status).toBe('DONE')
          // Should update existing SWAP transaction
          const swapTx = result.execution?.transactions.find(
            (t: Transaction) => t.type === 'SWAP'
          )
          expect(swapTx?.txHash).toBe('0xabc123')
        })
      })

      describe('and transitioning to an invalid status', () => {
        it('should throw an error', () => {
          // PENDING -> CANCELLED is not valid in the transitions
          expect(() =>
            statusManager.transitionExecutionStatus(
              structuredClone(step),
              'CANCELLED'
            )
          ).toThrow('Invalid transition: PENDING → CANCELLED')
        })
      })

      describe('and transitioning to the same status', () => {
        it('should not throw and still call callbacks', () => {
          const result = statusManager.transitionExecutionStatus(
            structuredClone(step),
            'PENDING'
          ) as LiFiStepExtended

          expect(result.execution?.status).toBe('PENDING')
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

      it('should throw an error', () => {
        expect(() =>
          statusManager.transitionExecutionType(
            structuredClone(step),
            'CROSS_CHAIN'
          )
        ).toThrow('Execution must be initialized before transitioning')
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      describe('and transitioning to a valid type', () => {
        it('should update the type and call the callbacks', () => {
          // SWAP -> RECEIVING_CHAIN is valid
          const result = statusManager.transitionExecutionType(
            structuredClone(step),
            'RECEIVING_CHAIN'
          ) as LiFiStepExtended

          expect(result.execution?.type).toBe('RECEIVING_CHAIN')
          expect(updateRouteHookMock).toHaveBeenCalled()
        })

        it('should update additional execution properties when provided', () => {
          const result = statusManager.transitionExecutionType(
            structuredClone(step),
            'RECEIVING_CHAIN',
            {
              chainId: 42161,
            }
          ) as LiFiStepExtended

          expect(result.execution?.type).toBe('RECEIVING_CHAIN')
          expect(result.execution?.chainId).toBe(42161)
        })
      })

      describe('and transitioning to an invalid type', () => {
        it('should throw an error', () => {
          // SWAP -> TOKEN_ALLOWANCE is not valid
          expect(() =>
            statusManager.transitionExecutionType(
              structuredClone(step),
              'TOKEN_ALLOWANCE'
            )
          ).toThrow('Invalid type transition: SWAP → TOKEN_ALLOWANCE')
        })
      })

      describe('and transitioning to the same type', () => {
        it('should not throw and still call callbacks', () => {
          const result = statusManager.transitionExecutionType(
            structuredClone(step),
            'SWAP'
          ) as LiFiStepExtended

          expect(result.execution?.type).toBe('SWAP')
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
