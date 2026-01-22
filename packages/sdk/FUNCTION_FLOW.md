# SDK Function Flow

This document shows how execution flows through functions in the LI.FI SDK codebase.

## Entry Points

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Application                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  executeRoute() / resumeRoute()│  ← @lifi/sdk
              └───────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  executeSteps() │  ← @lifi/sdk (internal)
                    └─────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐
│EthereumStep   │   │SolanaStep       │   │SuiStep          │
│Executor       │   │Executor         │   │Executor         │
└───────────────┘   └─────────────────┘   └─────────────────┘
        │                     │                     │
        │   @lifi/sdk-provider-ethereum            │
        │                     │   @lifi/sdk-provider-solana
        │                     │                     │
        │                     │       @lifi/sdk-provider-sui
```

## Ethereum Execution Flow

### EthereumStepExecutor.executeStep()

```
executeStep(client, step)
│
├─► initExecution(step, executionType)     // Initialize or reset execution
│   └─► Sets status: 'STARTED', clears state if FAILED
│
├─► checkClient()                          // Ensure correct chain & wallet
│   └─► switchChain()                      // Switch if needed
│
├─► checkAllowance()                       // TOKEN_ALLOWANCE phase
│   │
│   │   ┌─────────────────────────────────────────────────────────────┐
│   │   │ TOKEN_ALLOWANCE Flow                                        │
│   │   ├─────────────────────────────────────────────────────────────┤
│   │   │ updateExecution(step, { type: 'TOKEN_ALLOWANCE', status: 'STARTED' })│
│   │   │         │                                                   │
│   │   │         ├─► getAllowance()                                  │
│   │   │         │   └─► If approved → status: PENDING (skip)        │
│   │   │         │                                                   │
│   │   │         ├─► updateExecution(step, { status: 'RESET_REQUIRED' })│
│   │   │         │   └─► setAllowance(0)  // Reset if needed         │
│   │   │         │                                                   │
│   │   │         ├─► updateExecution(step, { status: 'ACTION_REQUIRED' })│
│   │   │         │   └─► setAllowance()   // User signs approval tx  │
│   │   │         │                                                   │
│   │   │         └─► waitForTransactionReceipt()                     │
│   │   │             └─► status: PENDING, transaction: { isDone: true }│
│   │   └─────────────────────────────────────────────────────────────┘
│   │
│   │   ┌─────────────────────────────────────────────────────────────┐
│   │   │ PERMIT Flow (if native permit available)                    │
│   │   ├─────────────────────────────────────────────────────────────┤
│   │   │ updateExecution(step, { type: 'PERMIT', status: 'STARTED' })│
│   │   │ updateExecution(step, { status: 'ACTION_REQUIRED' })        │
│   │   │         │                                                   │
│   │   │         └─► signTypedData()  // User signs permit message   │
│   │   │             └─► status: PENDING                             │
│   │   └─────────────────────────────────────────────────────────────┘
│
├─► updateExecution(step, { type: 'SWAP' | 'CROSS_CHAIN', status: 'STARTED' })
│
├─► checkBalance()                         // Verify sufficient balance
│
├─► prepareUpdatedStep()                   // Get transaction request
│   ├─► getStepTransaction()               // API call for tx data
│   ├─► getContractCallsQuote()            // For contract calls
│   └─► getRelayerQuote()                  // For relayer transactions
│
├─► updateExecution(step, { status: 'ACTION_REQUIRED' })
│
├─► [User Interaction Required]
│   │
│   ├─► For Batched Transactions (EIP-5792):
│   │   └─► sendCalls()
│   │
│   ├─► For Relayer Transactions:
│   │   ├─► status: MESSAGE_REQUIRED
│   │   ├─► signTypedData()                // Sign intent
│   │   ├─► status: PENDING
│   │   └─► relayTransaction()             // Submit to relayer
│   │
│   └─► For Standard Transactions:
│       ├─► signPermit2Message()           // If permit2 supported
│       │   └─► status: MESSAGE_REQUIRED → ACTION_REQUIRED
│       └─► sendTransaction()              // User signs & submits
│
├─► updateExecution(step, { status: 'PENDING', transaction: { txHash } })
│
└─► waitForTransaction()
    │
    ├─► waitForTransactionReceipt()        // Wait for source chain confirm
    │   └─► For non-bridge: status: DONE
    │
    └─► waitForDestinationChainTransaction()  // For bridges only
        │
        ├─► updateExecution(step, { type: 'RECEIVING_CHAIN', status: 'PENDING', ... })
        │
        └─► waitForTransactionStatus()     // Poll API for bridge status
            │
            ├─► getStatus()                // API call
            │   └─► Loop until DONE or FAILED
            │
            └─► status: DONE or FAILED
```

## Solana Execution Flow

### SolanaStepExecutor.executeStep()

```
executeStep(client, step)
│
├─► initExecution(step, executionType)     // Initialize or reset execution
│
├─► checkBalance()                         // Verify SOL/token balance
│
├─► getStepTransaction()                   // Get transaction from API
│
├─► updateExecution(step, { type, status: 'ACTION_REQUIRED' })
│
├─► getWalletFeature(wallet, SolanaSignTransaction)
│   └─► signTransaction()                  // User signs in wallet
│
├─► updateExecution(step, { type, status: 'PENDING' })
│
├─► sendAndConfirmTransaction()            // Submit to Solana network
│   ├─► rpc.sendTransaction()
│   └─► waitForTransactionConfirmation()
│
├─► updateExecution(step, { type, status: 'PENDING', transaction: { txHash, isDone } })
│
└─► [If Bridge]
    └─► waitForDestinationChainTransaction()
        └─► status: DONE, transaction: { type: 'RECEIVING_CHAIN', isDone: true }
```

## Sui Execution Flow

### SuiStepExecutor.executeStep()

```
executeStep(client, step)
│
├─► initExecution(step, executionType)     // Initialize or reset execution
│
├─► checkBalance()                         // Verify SUI/token balance
│
├─► getStepTransaction()                   // Get transaction from API
│
├─► updateExecution(step, { type, status: 'ACTION_REQUIRED' })
│
├─► wallet.signAndExecuteTransaction()     // User signs & executes
│
├─► updateExecution(step, { type, status: 'PENDING' })
│
├─► client.waitForTransaction()            // Wait for confirmation
│
├─► updateExecution(step, { type, status: 'PENDING', transaction: { txHash, isDone } })
│
└─► [If Bridge]
    └─► waitForDestinationChainTransaction()
        └─► status: DONE, transaction: { type: 'RECEIVING_CHAIN', isDone: true }
```

## Simplified Flow with Status Transitions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ executeRoute()                                                                │
│   └── executeSteps()                                                          │
│         └── for each step:                                                    │
│               └── stepExecutor.executeStep()                                  │
│                     │                                                         │
│                     ├─► initExecution(step, type)  // Initialize/reset        │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ TOKEN_ALLOWANCE (EVM only)                         │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING              │ │
│                     │  │   transaction: { isDone: true }                    │ │
│                     │  │   (or STARTED → PENDING if already approved)       │ │
│                     │  │   (or STARTED → RESET_REQUIRED → ... → PENDING)    │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ PERMIT (EVM only, optional)                        │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING              │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ SWAP or CROSS_CHAIN                                │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING              │ │
│                     │  │   (or → MESSAGE_REQUIRED → PENDING)                │ │
│                     │  │   transaction: { isDone: true } for swaps          │ │
│                     │  │   transaction: { isDone: false } for bridges       │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     └─►│ RECEIVING_CHAIN (bridges only)                     │ │
│                        │   PENDING → DONE                                   │ │
│                        │   transaction: { isDone: true }                    │ │
│                        └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

> **Note:** `DONE` status is only set once at the end of the entire step execution (in `waitForDestinationChainTransaction` for bridges, or after the main transaction for swaps). Individual transactions track completion via the `isDone` flag.

## Key Functions Reference

### @lifi/sdk (Core)

| Function | File | Purpose |
|----------|------|---------|
| `executeRoute()` | `core/execution.ts` | Entry point for route execution |
| `resumeRoute()` | `core/execution.ts` | Resume failed/stopped routes |
| `executeSteps()` | `core/execution.ts` | Loop through route steps |
| `stopRouteExecution()` | `core/execution.ts` | Stop active execution |
| `getActiveRoutes()` | `core/execution.ts` | Get currently executing routes |
| `prepareRestart()` | `core/prepareRestart.ts` | Prepare route for restart (filter incomplete transactions) |
| `StatusManager.initExecution()` | `core/StatusManager.ts` | Initialize or reset step execution |
| `StatusManager.updateExecution()` | `core/StatusManager.ts` | Update execution status/type/properties |
| `waitForTransactionStatus()` | `core/waitForTransactionStatus.ts` | Poll API for tx status |
| `waitForDestinationChainTransaction()` | `core/waitForDestinationChainTransaction.ts` | Wait for bridge completion |
| `checkBalance()` | `core/checkBalance.ts` | Verify token balance |
| `getStepTransaction()` | `actions/getStepTransaction.ts` | Get transaction data from API |
| `getStatus()` | `actions/getStatus.ts` | Get transaction status from API |

### StatusManager API

```typescript
class StatusManager {
  // Initialize execution for a step (or reset if FAILED)
  initExecution(step: LiFiStepExtended, type: TransactionType): LiFiStepExtended

  // Update execution with new status, type, transaction, etc.
  updateExecution(step: LiFiStepExtended, execution: ExecutionUpdate): LiFiStepExtended
}

type ExecutionUpdate = {
  type: TransactionType        // Required: current transaction type
  status: ExecutionStatus      // Required: new status
  transaction?: Transaction    // Optional: add/update a transaction
  // ... other optional Execution fields
}
```

**initExecution behavior:**
- No execution exists → Create new with `status: 'STARTED'`
- Status is `FAILED` → Reset to `STARTED`, clear error/timestamps/transactions
- Otherwise → Filter transactions to keep only `isDone: true`, return step

**updateExecution behavior:**
- Automatically sets timestamps based on status
- Automatically clears `substatus`/`substatusMessage` when status changes (unless explicitly provided)
- Adds/updates transaction in `transactions` array if `transaction` is provided

### When updateRouteHook is Called

```
initExecution() / updateExecution()
    │
    └─► updateStepInRoute()
        │
        └─► executionOptions.updateRouteHook?.(route)  // ◄── Your callback
```

Every status transition triggers `updateRouteHook`, allowing your UI to react to:
- Status changes (STARTED, ACTION_REQUIRED, PENDING, DONE, FAILED)
- Transaction type changes (TOKEN_ALLOWANCE, SWAP, CROSS_CHAIN, etc.)
- Transaction updates (txHash, chainId, isDone)
- Error information
- Substatus updates (for bridge progress tracking)
