import type { ChainId, FeeCost, GasCost, Substatus, Token } from '@lifi/types'
import { getProcessMessage } from './processMessages.js'
import type { ExecutionStatus, ProcessStatus, ProcessType } from './types.js'

export abstract class FSM<TStatus extends string> {
  private _status: TStatus

  private transitions: Record<
    TStatus,
    {
      allowed: TStatus[]
      onEnter?: () => void
    }
  >

  constructor(
    initialState: TStatus,
    transitions: Record<TStatus, { allowed: TStatus[]; onEnter?: () => void }>
  ) {
    this._status = initialState
    this.transitions = transitions
  }

  get status(): TStatus {
    return this._status
  }

  canTransition(to: TStatus): boolean {
    return this.transitions[this._status]?.allowed.includes(to)
  }

  transition(to: TStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid transition from ${this.status} to ${to}`)
    }

    this._status = to
    this.transitions[to]?.onEnter?.()
  }
}

export class NewProcess extends FSM<ProcessStatus> {
  type: ProcessType
  substatus?: Substatus
  chainId?: number
  txHash?: string
  multisigTxHash?: string
  txLink?: string
  actionRequiredAt?: number
  doneAt?: number
  failedAt?: number
  pendingAt?: number
  startedAt: number
  message?: string
  error?: {
    code: string | number
    message: string
    htmlMessage?: string
  };

  // additional information
  [key: string]: any

  constructor(
    type: ProcessType,
    status?: ProcessStatus,
    chainId?: ChainId,
    startedAt?: number
  ) {
    super(status ?? 'STARTED', {
      STARTED: {
        allowed: ['PENDING', 'ACTION_REQUIRED', 'FAILED', 'DONE', 'CANCELLED'],
      },
      PENDING: {
        allowed: ['ACTION_REQUIRED', 'FAILED', 'DONE', 'CANCELLED'],
        onEnter: () => {
          this.pendingAt = Date.now()
        },
      },
      ACTION_REQUIRED: {
        allowed: ['PENDING', 'FAILED', 'CANCELLED'],
        onEnter: () => {
          this.actionRequiredAt = Date.now()
        },
      },
      FAILED: {
        allowed: ['PENDING', 'CANCELLED'],
        onEnter: () => {
          this.doneAt = Date.now()
        },
      },
      DONE: {
        allowed: [],
        onEnter: () => {
          this.doneAt = Date.now()
        },
      },
      CANCELLED: {
        allowed: [],
        onEnter: () => {
          this.doneAt = Date.now()
        },
      },
    })
    this.type = type
    this.chainId = chainId
    this.startedAt = startedAt ?? Date.now()
    this.message = getProcessMessage(this.type, this.status)
  }

  override transition(to: ProcessStatus): void {
    super.transition(to)
    this.message = getProcessMessage(this.type, this.status)
  }

  private static updatableKeys = [
    'type',
    'substatus',
    'chainId',
    'txHash',
    'multisigTxHash',
    'txLink',
    'actionRequiredAt',
    'doneAt',
    'failedAt',
    'pendingAt',
    'startedAt',
    'message',
    'error',
  ] as const

  update(
    updates: Partial<
      Pick<NewProcess, (typeof NewProcess.updatableKeys)[number]>
    >
  ): void {
    for (const key of NewProcess.updatableKeys) {
      if (updates[key] !== undefined) {
        ;(this as any)[key] = updates[key]!
      }
    }
  }
}

export class NewExecution extends FSM<ExecutionStatus> {
  startedAt: number
  doneAt?: number
  process: Array<NewProcess>
  fromAmount?: string
  toAmount?: string
  toToken?: Token
  feeCosts?: FeeCost[]
  gasCosts?: GasCost[]

  constructor() {
    super('IDLE', {
      IDLE: {
        allowed: ['PENDING'],
      },
      PENDING: {
        allowed: ['ACTION_REQUIRED', 'FAILED', 'DONE'],
        onEnter: () => {
          this.startedAt = Date.now()
        },
      },
      ACTION_REQUIRED: {
        allowed: ['PENDING', 'FAILED'],
      },
      FAILED: {
        allowed: ['PENDING'],
      },
      DONE: {
        allowed: [],
        onEnter: () => {
          this.doneAt = Date.now()
        },
      },
    })
    this.startedAt = 0
    this.process = []
  }

  private static updatableKeys = [
    'startedAt',
    'doneAt',
    'process',
    'fromAmount',
    'toAmount',
    'toToken',
    'feeCosts',
    'gasCosts',
  ] as const

  update(
    updates: Partial<
      Pick<NewExecution, (typeof NewExecution.updatableKeys)[number]>
    >
  ): void {
    for (const key of NewExecution.updatableKeys) {
      if (updates[key] !== undefined) {
        ;(this as any)[key] = updates[key]!
      }
    }
  }
}
