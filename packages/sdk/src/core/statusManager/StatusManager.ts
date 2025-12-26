import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionStatus,
  LiFiStepExtended,
  Transaction,
  TransactionType,
} from '../../types/core.js'
import { executionState } from '../executionState.js'
import { getProcessMessage } from '../processMessages.js'
import { onStatusTransition } from './sideEffects.js'
import { statusTransitions, transactionTransitions } from './transitions.js'

export type ExecutionStatusUpdate = Partial<
  Pick<
    Execution,
    | 'error'
    | 'signedTypedData'
    | 'substatus'
    | 'substatusMessage'
    | 'fromAmount'
    | 'toAmount'
    | 'toToken'
    | 'internalTxLink'
    | 'externalTxLink'
    | 'gasCosts'
    | 'feeCosts'
  >
> & {
  transaction?: Transaction
}

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
  ): LiFiStep {
    if (execution) {
      const { transaction, ...executionUpdate } = execution

      step.execution = {
        ...(step.execution ? { ...step.execution } : { transactions: [] }),
        ...executionUpdate,
      } as Execution

      if (transaction) {
        const index = step.execution.transactions.findIndex(
          (t) => t.type === transaction.type
        )
        if (index >= 0) {
          step.execution.transactions[index] = transaction
        } else {
          step.execution.transactions.push(transaction)
        }
      }
    }

    const currentStatus = step.execution?.status ?? 'PENDING'

    if (currentStatus === newStatus) {
      this.updateStepInRoute(step)

      return step
    }

    // Validate status transition
    if (!statusTransitions[currentStatus].includes(newStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`)
    }

    // Update status
    step.execution!.status = newStatus

    // Execute side effects
    onStatusTransition[newStatus](step.execution!)

    // Update message
    step.execution!.message = getProcessMessage(step.execution!.type, newStatus)

    this.updateStepInRoute(step)

    return step
  }

  transitionExecutionType(
    step: LiFiStepExtended,
    newType: TransactionType,
    execution?: Omit<Partial<Execution>, 'type'>
  ): LiFiStep {
    if (!step.execution) {
      throw new Error('Execution must be initialized before transitioning')
    }

    // Merge additional properties if provided
    if (execution) {
      step.execution = {
        ...step.execution,
        ...execution,
      } as Execution
    }

    const currentType = step.execution.type

    if (currentType === newType) {
      this.updateStepInRoute(step)

      return step
    }

    // Validate type transition
    if (!transactionTransitions[currentType].includes(newType)) {
      throw new Error(`Invalid type transition: ${currentType} → ${newType}`)
    }

    // Update type
    step.execution.type = newType
    step.execution.message = getProcessMessage(newType, 'PENDING')

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
