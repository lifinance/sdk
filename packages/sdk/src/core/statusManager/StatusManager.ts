import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionUpdate,
  LiFiStepExtended,
} from '../../types/core.js'
import { executionState } from '../executionState.js'
import { getProcessMessage } from '../processMessages.js'

/**
 * Manages status updates of a route and provides various functions for tracking processes
 * @param {string} routeId The route id this StatusManager belongs to.
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
    execution: ExecutionUpdate
  ): LiFiStepExtended {
    const { status, type, transaction, ...executionUpdate } = execution

    // Update execution with all properties
    step.execution = {
      ...step.execution,
      ...executionUpdate,
      ...(type && { type }),
      ...(status && {
        status,
        message: getProcessMessage(step.execution?.type ?? type!, status),
      }),
    } as Execution

    // Handle transaction: add or update in transactions array
    if (transaction) {
      const existingIndex = step.execution.transactions.findIndex(
        (t) => t.type === transaction.type
      )

      step.execution = {
        ...step.execution,
        transactions:
          existingIndex >= 0
            ? step.execution.transactions.with(existingIndex, transaction)
            : [...step.execution.transactions, transaction],
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
