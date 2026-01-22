import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionUpdate,
  LiFiStepExtended,
  Transaction,
  TransactionType,
} from '../types/core.js'
import { executionState } from './executionState.js'
import { getProcessMessage } from './processMessages.js'

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

  initExecution(
    step: LiFiStepExtended,
    type: TransactionType
  ): LiFiStepExtended {
    if (!step.execution || step.execution.status === 'FAILED') {
      return this.updateExecution(step, {
        type,
        status: 'STARTED',
        transactions: [],
        // Reset from previous (failed) execution
        error: undefined,
        doneAt: undefined,
        pendingAt: undefined,
        actionRequiredAt: undefined,
        substatus: undefined,
        substatusMessage: undefined,
      })
    }
    return step
  }

  updateExecution(
    step: LiFiStepExtended,
    execution: ExecutionUpdate
  ): LiFiStepExtended {
    const { status, type, transaction, ...executionUpdate } = execution
    const previousStatus = step.execution?.status

    // Clear substatus if status changed and no new substatus provided
    const shouldClearSubstatus =
      status !== previousStatus && !('substatus' in executionUpdate)

    step.execution = {
      ...step.execution,
      ...executionUpdate,
      type,
      status,
      message: getProcessMessage(type, status),
      ...(shouldClearSubstatus && {
        substatus: undefined,
        substatusMessage: undefined,
      }),
    } as Execution

    if (transaction) {
      step.execution.transactions = this.updateTransactions(step, transaction)
    }

    switch (status) {
      case 'STARTED':
        step.execution.startedAt = Date.now()
        break
      case 'CANCELLED':
      case 'FAILED':
      case 'DONE': {
        step.execution.doneAt = Date.now()
        break
      }
      case 'PENDING':
        step.execution.pendingAt = Date.now()
        break
      case 'RESET_REQUIRED':
      case 'MESSAGE_REQUIRED':
      case 'ACTION_REQUIRED':
        step.execution.actionRequiredAt = Date.now()
        break
      default:
        break
    }

    this.updateStepInRoute(step)

    return step
  }

  updateTransactions = (
    step: LiFiStepExtended,
    transactionUpdate: Partial<Transaction>
  ): Transaction[] => {
    if (!step.execution || !transactionUpdate.type) {
      return step.execution?.transactions || []
    }

    const existingIndex = step.execution.transactions.findIndex(
      (t) => t.type === transactionUpdate.type
    )

    if (existingIndex >= 0) {
      const updatedTransaction = {
        ...step.execution.transactions[existingIndex],
        ...transactionUpdate,
      }
      return step.execution.transactions.with(existingIndex, updatedTransaction)
    }

    return [
      ...step.execution.transactions,
      {
        type: transactionUpdate.type,
        ...transactionUpdate,
      },
    ]
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
