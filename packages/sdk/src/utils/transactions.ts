import type { ExecutionAction } from '../types/core.js'

/**
 * Returns true if the action exists, has no txHash/taskId yet, and is not DONE.
 * Use this to decide whether a task that depends on a prepared transaction should run.
 */
export function isTransactionPrepared(action?: ExecutionAction): boolean {
  return (
    !!action && !(action.txHash || action.taskId) && action.status !== 'DONE'
  )
}

/**
 * Returns true if the action exists, has a txHash/taskId, and is not DONE.
 * Use this to decide whether a task that depends on a prepared transaction should run.
 */
export function isTransactionPending(action?: ExecutionAction): boolean {
  return (
    !!action && !!(action.txHash || action.taskId) && action.status !== 'DONE'
  )
}
