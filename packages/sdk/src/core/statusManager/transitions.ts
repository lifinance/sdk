import type { ExecutionStatus, TransactionType } from '../../types/core.js'

export const transactionTransitions: Record<
  TransactionType,
  TransactionType[]
> = {
  TOKEN_ALLOWANCE: ['PERMIT', 'SWAP', 'CROSS_CHAIN'],
  PERMIT: ['SWAP', 'CROSS_CHAIN'],
  SWAP: ['RECEIVING_CHAIN'],
  CROSS_CHAIN: ['RECEIVING_CHAIN'],
  RECEIVING_CHAIN: [],
}

export const statusTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
  STARTED: [
    'ACTION_REQUIRED',
    'PENDING',
    'FAILED',
    'CANCELLED',
    'RESET_REQUIRED',
    'DONE',
  ],
  ACTION_REQUIRED: [
    'PENDING',
    'MESSAGE_REQUIRED',
    'FAILED',
    'CANCELLED',
    'RESET_REQUIRED',
  ],
  MESSAGE_REQUIRED: ['PENDING', 'ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  RESET_REQUIRED: ['PENDING', 'ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  PENDING: ['STARTED', 'DONE', 'FAILED', 'ACTION_REQUIRED', 'RESET_REQUIRED'],
  FAILED: ['PENDING'],
  DONE: [],
  CANCELLED: [],
}
