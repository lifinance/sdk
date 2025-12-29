import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionStatus,
  ExecutionStatusUpdate,
  LiFiStepExtended,
  Transaction,
  TransactionType,
} from '../../types/core.js'
import { executionState } from '../executionState.js'
import { getProcessMessage } from '../processMessages.js'
import { onStatusTransition } from './onStatusTransition.js'
import { statusTransitions, transactionTransitions } from './transitions.js'

/**
 * Manages status updates of a route and provides various functions for tracking processes
 * @param {string} routeId The route dd this StatusManger belongs to.
 * @returns {StatusManager} An instance of StatusManager.
 */
export class StatusManager {
  private readonly routeId: string
  private shouldUpdate = true

  constructor(routeId: string) {
    this.routeId = routeId
  }

  transitionExecutionStatus(
    step: LiFiStepExtended,
    newStatus: ExecutionStatus,
    execution?: ExecutionStatusUpdate
  ): LiFiStepExtended {
    const currentStatus = step.execution?.status
    const isSameStatus = currentStatus && currentStatus === newStatus

    // Early return only if same status AND no execution updates to apply
    if (isSameStatus && !execution) {
      return step
    }

    // Validate status transition (skip if same status with updates)
    if (
      !isSameStatus &&
      currentStatus &&
      !statusTransitions[currentStatus].includes(newStatus)
    ) {
      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`)
    }

    if (!currentStatus && !execution?.type) {
      throw new Error('Execution must have type to transition status')
    }

    // Initialize execution or update timestamp
    const timestampUpdateOrInit = onStatusTransition[newStatus](currentStatus)
    step.execution = {
      ...step.execution,
      ...timestampUpdateOrInit,
    } as Execution

    if (execution) {
      const { transaction, ...executionUpdate } = execution

      // Update execution with new properties
      step.execution = {
        ...step.execution,
        ...executionUpdate,
      } as Execution

      // Override transaction or add a new transaction
      if (transaction) {
        const transactionType = step.execution?.type
        const existingIndex = step.execution.transactions.findIndex(
          (t) => t.type === transactionType
        )
        const transactionWithType = {
          ...transaction,
          type: transactionType,
        } as Transaction

        step.execution = {
          ...step.execution,
          transactions:
            existingIndex >= 0
              ? step.execution.transactions.with(
                  existingIndex,
                  transactionWithType
                )
              : [...step.execution.transactions, transactionWithType],
        } as Execution
      }
    }

    // Update status and message
    step.execution = {
      ...step.execution,
      status: newStatus,
      message: getProcessMessage(step.execution.type, newStatus),
    } as Execution

    this.updateStepInRoute(step)

    return step
  }

  transitionExecutionType(
    step: LiFiStepExtended,
    newType: TransactionType,
    chainId: number
  ): LiFiStepExtended {
    const currentType = step.execution?.type
    if (currentType && currentType === newType) {
      return step
    }

    // Validate type transition
    if (currentType && !transactionTransitions[currentType].includes(newType)) {
      throw new Error(`Invalid type transition: ${currentType} → ${newType}`)
    }

    return this.transitionExecutionStatus(step, 'PENDING', {
      type: newType,
      chainId,
    })
  }

  updateStepInRoute = (step: LiFiStep): LiFiStep => {
    if (!this.shouldUpdate) {
      return step
    }
    const data = executionState.get(this.routeId)

    if (!data) {
      throw new Error('Execution data not found.')
    }

    const stepIndex = data.route.steps.findIndex(
      (routeStep) => routeStep.id === step.id
    )

    if (stepIndex === -1) {
      throw new Error("Couldn't find a step to update.")
    }

    data.route.steps[stepIndex] = { ...data.route.steps[stepIndex], ...step }

    data.executionOptions?.updateRouteHook?.(data.route)
    return data.route.steps[stepIndex]
  }

  allowUpdates(value: boolean): void {
    this.shouldUpdate = value
  }
}
