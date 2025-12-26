import type { ExecutionStatus, TransactionType } from '../../types/core.js'

export const transactionTransitions: Record<
  TransactionType,
  TransactionType[]
> = {
  TOKEN_ALLOWANCE: ['PERMIT', 'SWAP', 'CROSS_CHAIN'], // After approval
  PERMIT: ['SWAP', 'CROSS_CHAIN'], // After permit signed
  SWAP: ['RECEIVING_CHAIN'], // For bridge, wait for dest
  CROSS_CHAIN: ['RECEIVING_CHAIN'], // Wait for destination
  RECEIVING_CHAIN: [], // Terminal
}

export const statusTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
  STARTED: ['ACTION_REQUIRED', 'PENDING', 'FAILED', 'CANCELLED'],
  ACTION_REQUIRED: ['PENDING', 'MESSAGE_REQUIRED', 'FAILED', 'CANCELLED'],
  MESSAGE_REQUIRED: ['PENDING', 'ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  RESET_REQUIRED: ['PENDING', 'ACTION_REQUIRED', 'FAILED', 'CANCELLED'],
  PENDING: ['STARTED', 'DONE', 'FAILED', 'ACTION_REQUIRED'],
  FAILED: ['PENDING'], // Resume from failed
  DONE: [], // Terminal state
  CANCELLED: [], // Terminal state
}
