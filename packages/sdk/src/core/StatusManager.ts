import type { LiFiStep } from '@lifi/types'
import type {
  Execution,
  ExecutionAction,
  ExecutionUpdate,
  LiFiStepExtended,
} from '../types/core.js'
import { getExecutionMessage } from './executionMessages.js'
import { executionState } from './executionState.js'

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
    const { status, type, action, ...executionUpdate } = execution
    const previousStatus = step.execution?.status

    // Clear substatus if status changed and no new substatus provided
    const shouldClearSubstatus =
      status !== previousStatus && !('substatus' in executionUpdate)

    step.execution = {
      ...step.execution,
      ...executionUpdate,
      type,
      status,
      message: getExecutionMessage(type, status),
      ...(shouldClearSubstatus && {
        substatus: undefined,
        substatusMessage: undefined,
      }),
    } as Execution

    if (action) {
      step.execution.actions = this.updateActions(step, action)
    }

    this.updateStepInRoute(step)

    return step
  }

  updateActions = (
    step: LiFiStepExtended,
    actionUpdate: Partial<ExecutionAction>
  ): ExecutionAction[] => {
    if (!step.execution || !actionUpdate.type) {
      return step.execution?.actions || []
    }

    const existingIndex = step.execution.actions.findIndex(
      (t) => t.type === actionUpdate.type
    )

    if (existingIndex >= 0) {
      const updatedAction = {
        ...step.execution.actions[existingIndex],
        ...actionUpdate,
      }
      return step.execution.actions.with(existingIndex, updatedAction)
    }

    return [
      ...step.execution.actions,
      {
        type: actionUpdate.type,
        ...actionUpdate,
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
