import type { TaskContext } from '@lifi/sdk'
import type { EthereumTaskExtra } from '../types.js'

/**
 * Shared shouldRun logic for all sign-and-execute tasks (standard, batch, relayer).
 * Run when no tx/taskId yet and action not DONE.
 */
export function shouldRunSignAndExecute(
  context: TaskContext<EthereumTaskExtra>
): boolean {
  const { action } = context
  return !action.txHash && !action.taskId && action.status !== 'DONE'
}
