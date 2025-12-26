import type { Execution, ExecutionStatus } from '../../types/core.js'

export const onStatusTransition: Record<
  ExecutionStatus,
  (execution: Execution, fromStatus?: ExecutionStatus) => void
> = {
  STARTED: (e) => {
    e.startedAt = Date.now()
  },
  PENDING: (e, from) => {
    e.pendingAt = Date.now()
    if (from === 'FAILED') {
      e.startedAt = Date.now()
    }
  },
  ACTION_REQUIRED: (e) => {
    e.actionRequiredAt = Date.now()
  },
  MESSAGE_REQUIRED: (e) => {
    e.actionRequiredAt = Date.now()
  },
  RESET_REQUIRED: (e) => {
    e.actionRequiredAt = Date.now()
  },
  DONE: (e) => {
    e.doneAt = Date.now()
  },
  FAILED: (e) => {
    e.doneAt = Date.now()
  },
  CANCELLED: (e) => {
    e.doneAt = Date.now()
  },
}
