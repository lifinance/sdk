import type { Route } from '@lifi/types'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionAction, LiFiStepExtended } from '../types/core.js'
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

      it('should create execution with all required fields', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'SWAP',
          status: 'PENDING',
          startedAt: Date.now(),
          actions: [],
        })

        expect(result.execution).toMatchObject({
          type: 'SWAP',
          status: 'PENDING',
          startedAt: SOME_DATE,
          actions: [],
        })
        expect(updateRouteHookMock).toHaveBeenCalled()
      })
    })

    describe('when an execution is defined', () => {
      beforeEach(() => {
        statusManager = initializeStatusManager({ includingExecution: true })
      })

      it('should update status and additional properties', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'SWAP',
          status: 'DONE',
          fromAmount: '123',
          toAmount: '456',
        })

        expect(result.execution).toMatchObject({
          status: 'DONE',
          fromAmount: '123',
          toAmount: '456',
        })
        expect(updateRouteHookMock).toHaveBeenCalled()
      })

      it('should update type', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'RECEIVING_CHAIN',
          status: 'PENDING',
        })

        expect(result.execution!.type).toBe('RECEIVING_CHAIN')
      })

      it('should update an existing action', () => {
        const result = statusManager.updateExecution(structuredClone(step), {
          type: 'SWAP',
          status: 'DONE',
          action: {
            type: 'SWAP',
            txHash: '0xabc123',
            txLink: 'https://example.com/tx/0xabc123',
          },
        })

        const swapAction = result.execution!.actions.find(
          (a: ExecutionAction) => a.type === 'SWAP'
        )
        expect(swapAction?.txHash).toBe('0xabc123')
      })

      it('should add a new action for different type', () => {
        const clonedStep = structuredClone(step)
        const stepWithNewType = statusManager.updateExecution(clonedStep, {
          type: 'RECEIVING_CHAIN',
          status: 'PENDING',
        })

        const result = statusManager.updateExecution(stepWithNewType, {
          type: 'RECEIVING_CHAIN',
          status: 'DONE',
          action: {
            type: 'RECEIVING_CHAIN',
            txHash: '0xdef456',
            txLink: 'https://example.com/tx/0xdef456',
          },
        })

        const receivingAction = result.execution!.actions.find(
          (a: ExecutionAction) => a.type === 'RECEIVING_CHAIN'
        )
        expect(receivingAction?.txHash).toBe('0xdef456')
      })

      it('should replace actions when filtered array is provided', () => {
        const clonedStep = structuredClone(step)
        expect(
          clonedStep.execution!.actions.find(
            (a: ExecutionAction) => a.type === 'SWAP'
          )
        ).toBeDefined()

        const result = statusManager.updateExecution(clonedStep, {
          type: 'SWAP',
          status: 'PENDING',
          actions: clonedStep.execution!.actions.filter(
            (a: ExecutionAction) => a.type !== 'SWAP'
          ),
        })

        expect(
          result.execution!.actions.find(
            (a: ExecutionAction) => a.type === 'SWAP'
          )
        ).toBeUndefined()
        expect(
          result.execution!.actions.find(
            (a: ExecutionAction) => a.type === 'TOKEN_ALLOWANCE'
          )
        ).toBeDefined()
      })
    })
  })

  describe('updateStepInRoute', () => {
    beforeEach(() => {
      statusManager = initializeStatusManager({ includingExecution: true })
    })

    it('should update the step in the route and call the hook', () => {
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

    it('should allow updates when re-enabled', () => {
      statusManager.allowUpdates(false)
      statusManager.allowUpdates(true)
      statusManager.updateStepInRoute(structuredClone(step))

      expect(updateRouteHookMock).toHaveBeenCalled()
    })
  })
})
