import type { TaskContext } from '@lifi/sdk'
import type { EthereumTaskExtra } from '../types.js'

/**
 * Shared shouldRun logic for all sign-and-execute tasks (standard, batch, relayer).
 * Run when transaction is not yet executed (no tx/taskId or not DONE).
 */
export function shouldRunSignAndExecute(
  context: TaskContext<EthereumTaskExtra>
): boolean {
  return !context.isTransactionExecuted()
}
