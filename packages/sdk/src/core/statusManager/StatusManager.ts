import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionStatusUpdate,
  LiFiStepExtended,
  Transaction,
} from '../../types/core.js'
import { executionState } from '../executionState.js'
import { getProcessMessage } from '../processMessages.js'
import { onStatusTransition } from './onStatusTransition.js'

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

  updateExecution(
    step: LiFiStepExtended,
    execution: ExecutionStatusUpdate
  ): LiFiStepExtended {
    const currentStatus = step.execution?.status
    const { transaction, status, ...executionUpdate } = execution

    // Require type for initialization
    if (!step.execution && !execution.type) {
      throw new Error('Execution must have type to initialize')
    }

    // Update execution with new properties first (to ensure type is available)
    step.execution = {
      ...step.execution,
      ...executionUpdate,
    } as Execution

    // Handle status transition with timestamps
    if (status) {
      const timestampUpdate = onStatusTransition[status](currentStatus)
      step.execution = {
        ...step.execution,
        ...timestampUpdate,
        status,
        message: getProcessMessage(step.execution.type, status),
      } as Execution
    }

    // Handle transaction: null = remove, object = update/add, undefined = skip
    if (transaction === null) {
      const transactionType = step.execution.type
      step.execution = {
        ...step.execution,
        transactions: step.execution.transactions.filter(
          (t) => t.type !== transactionType
        ),
      } as Execution
    } else if (transaction) {
      const transactionType = step.execution.type
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

    this.updateStepInRoute(step)

    return step
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
