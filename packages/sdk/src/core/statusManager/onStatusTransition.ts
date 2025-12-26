import type { Execution, ExecutionStatus } from '../../types/core.js'

export const onStatusTransition: Record<
  ExecutionStatus,
  (fromStatus?: ExecutionStatus) => Partial<Execution>
> = {
  STARTED: () => ({
    startedAt: Date.now(),
  }),
  PENDING: (from) => ({
    pendingAt: Date.now(),
    ...(!from || from === 'FAILED'
      ? { startedAt: Date.now(), transactions: [] }
      : {}),
  }),
  ACTION_REQUIRED: () => ({
    actionRequiredAt: Date.now(),
  }),
  MESSAGE_REQUIRED: () => ({
    actionRequiredAt: Date.now(),
  }),
  RESET_REQUIRED: () => ({
    actionRequiredAt: Date.now(),
  }),
  DONE: () => ({
    doneAt: Date.now(),
  }),
  FAILED: () => ({
    doneAt: Date.now(),
  }),
  CANCELLED: () => ({
    doneAt: Date.now(),
  }),
}
