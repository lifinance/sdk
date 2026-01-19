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
├─► checkClient()                          // Ensure correct chain & wallet
│   └─► switchChain()                      // Switch if needed
│
├─► checkAllowance()                       // TOKEN_ALLOWANCE phase
│   │
│   │   ┌─────────────────────────────────────────────────────────────┐
│   │   │ TOKEN_ALLOWANCE Flow                                        │
│   │   ├─────────────────────────────────────────────────────────────┤
│   │   │ updateExecution(step, { type: 'TOKEN_ALLOWANCE', ... })     │
│   │   │ updateExecution(step, { status: 'STARTED' })                │
│   │   │         │                                                   │
│   │   │         ├─► getAllowance()                                  │
│   │   │         │   └─► If approved → status: DONE (skip approval)  │
│   │   │         │                                                   │
│   │   │         ├─► updateExecution(step, { status: 'RESET_REQUIRED' })│
│   │   │         │   └─► setAllowance(0)  // Reset if needed         │
│   │   │         │                                                   │
│   │   │         ├─► updateExecution(step, { status: 'ACTION_REQUIRED' })│
│   │   │         │   └─► setAllowance()   // User signs approval tx  │
│   │   │         │                                                   │
│   │   │         └─► waitForTransactionReceipt()                     │
│   │   │             └─► status: DONE                                │
│   │   └─────────────────────────────────────────────────────────────┘
│   │
│   │   ┌─────────────────────────────────────────────────────────────┐
│   │   │ PERMIT Flow (if native permit available)                    │
│   │   ├─────────────────────────────────────────────────────────────┤
│   │   │ updateExecution(step, { type: 'PERMIT', ... })              │
│   │   │ updateExecution(step, { status: 'ACTION_REQUIRED' })        │
│   │   │         │                                                   │
│   │   │         └─► signTypedData()  // User signs permit message   │
│   │   │             └─► status: DONE                                │
│   │   └─────────────────────────────────────────────────────────────┘
│
├─► updateExecution(step, { type: 'SWAP' | 'CROSS_CHAIN', status: 'PENDING', ... })
│
├─► updateExecution(step, { status: 'STARTED' })
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
├─► updateExecution(step, { type: 'SWAP' | 'CROSS_CHAIN', status: 'PENDING', ... })
│
├─► updateExecution(step, { status: 'STARTED' })
│
├─► checkBalance()                         // Verify SOL/token balance
│
├─► getStepTransaction()                   // Get transaction from API
│
├─► updateExecution(step, { status: 'ACTION_REQUIRED' })
│
├─► getWalletFeature(wallet, SolanaSignTransaction)
│   └─► signTransaction()                  // User signs in wallet
│
├─► updateExecution(step, { status: 'PENDING' })
│
├─► sendAndConfirmTransaction()            // Submit to Solana network
│   ├─► rpc.sendTransaction()
│   └─► waitForTransactionConfirmation()
│
├─► updateExecution(step, { status: 'PENDING', transaction: { txHash } })
│
└─► [If Bridge]
    └─► waitForDestinationChainTransaction()
        └─► status: DONE
```

## Sui Execution Flow

### SuiStepExecutor.executeStep()

```
executeStep(client, step)
│
├─► updateExecution(step, { type: 'SWAP' | 'CROSS_CHAIN', status: 'PENDING', ... })
│
├─► updateExecution(step, { status: 'STARTED' })
│
├─► checkBalance()                         // Verify SUI/token balance
│
├─► getStepTransaction()                   // Get transaction from API
│
├─► updateExecution(step, { status: 'ACTION_REQUIRED' })
│
├─► wallet.signAndExecuteTransaction()     // User signs & executes
│
├─► updateExecution(step, { status: 'PENDING' })
│
├─► client.waitForTransaction()            // Wait for confirmation
│
├─► updateExecution(step, { status: 'PENDING', transaction: { txHash } })
│
└─► [If Bridge]
    └─► waitForDestinationChainTransaction()
        └─► status: DONE
```

## Simplified Flow with Status Transitions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ executeRoute()                                                                │
│   └── executeSteps()                                                          │
│         └── for each step:                                                    │
│               └── stepExecutor.executeStep()                                  │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ TOKEN_ALLOWANCE (EVM only)                         │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING → DONE      │ │
│                     │  │   (or STARTED → DONE if already approved)         │ │
│                     │  │   (or STARTED → RESET_REQUIRED → ... → DONE)      │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ PERMIT (EVM only, optional)                        │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING → DONE      │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     ├─►│ SWAP or CROSS_CHAIN                                │ │
│                     │  │   STARTED → ACTION_REQUIRED → PENDING → DONE      │ │
│                     │  │   (or → MESSAGE_REQUIRED → PENDING → DONE)        │ │
│                     │  └────────────────────────────────────────────────────┘ │
│                     │                                                         │
│                     │  ┌────────────────────────────────────────────────────┐ │
│                     └─►│ RECEIVING_CHAIN (bridges only)                     │ │
│                        │   PENDING → DONE                                   │ │
│                        └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Key Functions Reference

### @lifi/sdk (Core)

| Function | File | Purpose |
|----------|------|---------|
| `executeRoute()` | `core/execution.ts` | Entry point for route execution |
| `resumeRoute()` | `core/execution.ts` | Resume failed/stopped routes |
| `executeSteps()` | `core/execution.ts` | Loop through route steps |
| `stopRouteExecution()` | `core/execution.ts` | Stop active execution |
| `getActiveRoutes()` | `core/execution.ts` | Get currently executing routes |
| `StatusManager.updateExecution()` | `core/statusManager/StatusManager.ts` | Update execution status/type/properties |
| `waitForTransactionStatus()` | `core/waitForTransactionStatus.ts` | Poll API for tx status |
| `waitForDestinationChainTransaction()` | `core/waitForDestinationChainTransaction.ts` | Wait for bridge completion |
| `checkBalance()` | `core/checkBalance.ts` | Verify token balance |
| `getStepTransaction()` | `actions/getStepTransaction.ts` | Get transaction data from API |
| `getStatus()` | `actions/getStatus.ts` | Get transaction status from API |

### @lifi/sdk-provider-ethereum

| Function | File | Purpose |
|----------|------|---------|
| `EthereumStepExecutor.executeStep()` | `EthereumStepExecutor.ts` | Execute single EVM step |
| `checkAllowance()` | `actions/checkAllowance.ts` | Handle token approvals |
| `setAllowance()` | `actions/setAllowance.ts` | Set ERC-20 allowance |
| `getAllowance()` | `actions/getAllowance.ts` | Check current allowance |
| `switchChain()` | `actions/switchChain.ts` | Switch wallet chain |
| `waitForTransactionReceipt()` | `actions/waitForTransactionReceipt.ts` | Wait for tx confirmation |
| `signPermit2Message()` | `permits/signPermit2Message.ts` | Sign Permit2 message |

### @lifi/sdk-provider-solana

| Function | File | Purpose |
|----------|------|---------|
| `SolanaStepExecutor.executeStep()` | `SolanaStepExecutor.ts` | Execute single Solana step |
| `sendAndConfirmTransaction()` | `actions/sendAndConfirmTransaction.ts` | Submit and confirm tx |
| `getSolanaBalance()` | `actions/getSolanaBalance.ts` | Get token balances |

### @lifi/sdk-provider-sui

| Function | File | Purpose |
|----------|------|---------|
| `SuiStepExecutor.executeStep()` | `SuiStepExecutor.ts` | Execute single Sui step |

## Callback Hooks

The SDK provides hooks for UI updates during execution:

```
ExecutionOptions {
  updateRouteHook?: (route: RouteExtended) => void    // Called on every status change
  acceptExchangeRateUpdateHook?: (...)                // Called when rate changes
  infiniteApproval?: boolean                          // Set max approval amount
  executeInBackground?: boolean                       // Continue without user interaction
}
```

### When updateRouteHook is Called

```
updateExecution()
    │
    └─► updateStepInRoute()
        │
        └─► executionOptions.updateRouteHook?.(route)  // ◄── Your callback
```

Every status transition triggers `updateRouteHook`, allowing your UI to react to:
- Status changes (STARTED, ACTION_REQUIRED, PENDING, DONE, FAILED)
- Transaction type changes (TOKEN_ALLOWANCE, SWAP, CROSS_CHAIN, etc.)
- Transaction hash updates
- Error information

## Related Documentation

- [EXECUTION_FLOW.md](./EXECUTION_FLOW.md) - Status transitions and state diagrams
- [SDK Documentation](https://docs.li.fi/sdk/overview) - Official documentation
