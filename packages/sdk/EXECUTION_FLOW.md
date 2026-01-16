# SDK Execution Flow

This document explains how route execution works in the LI.FI SDK, including status transitions and transaction types.

## Transaction Types

Each step in a route goes through one or more transaction types in sequence:

```mermaid
flowchart LR
    TA[TOKEN_ALLOWANCE] --> P[PERMIT]
    TA --> S[SWAP]
    TA --> CC[CROSS_CHAIN]
    P --> S
    P --> CC
    S --> RC[RECEIVING_CHAIN]
    CC --> RC
```

| Type | Description |
|------|-------------|
| `TOKEN_ALLOWANCE` | Setting ERC-20 token approval for the contract |
| `PERMIT` | Signing a gasless permit message (ERC-2612) |
| `SWAP` | On-chain swap transaction |
| `CROSS_CHAIN` | Bridge transaction to another chain |
| `RECEIVING_CHAIN` | Waiting for tokens on destination chain |

## Execution Statuses

Each transaction type goes through these statuses:

```mermaid
stateDiagram-v2
    [*] --> STARTED
    
    STARTED --> ACTION_REQUIRED
    STARTED --> PENDING
    STARTED --> RESET_REQUIRED
    STARTED --> FAILED
    STARTED --> DONE
    
    ACTION_REQUIRED --> PENDING
    ACTION_REQUIRED --> MESSAGE_REQUIRED
    ACTION_REQUIRED --> RESET_REQUIRED
    ACTION_REQUIRED --> FAILED
    
    MESSAGE_REQUIRED --> PENDING
    MESSAGE_REQUIRED --> ACTION_REQUIRED
    MESSAGE_REQUIRED --> FAILED
    
    RESET_REQUIRED --> PENDING
    RESET_REQUIRED --> ACTION_REQUIRED
    RESET_REQUIRED --> FAILED
    
    PENDING --> DONE
    PENDING --> ACTION_REQUIRED
    PENDING --> RESET_REQUIRED
    PENDING --> FAILED
    
    FAILED --> PENDING
    
    DONE --> [*]
```

| Status | Description |
|--------|-------------|
| `STARTED` | Transaction is being prepared |
| `ACTION_REQUIRED` | User needs to sign a transaction |
| `MESSAGE_REQUIRED` | User needs to sign a message |
| `RESET_REQUIRED` | Token approval needs to be reset to 0 first |
| `PENDING` | Waiting for transaction confirmation |
| `DONE` | Transaction completed successfully |
| `FAILED` | Transaction failed (can retry) |

## Status Messages by Transaction Type

### TOKEN_ALLOWANCE
```mermaid
flowchart LR
    S[STARTED<br/><i>Setting token allowance</i>] --> AR[ACTION_REQUIRED<br/><i>Set token allowance</i>]
    S --> RR[RESET_REQUIRED<br/><i>Resetting token allowance</i>]
    AR --> P[PENDING<br/><i>Waiting for token allowance</i>]
    RR --> P
    P --> D[DONE<br/><i>Token allowance set</i>]
```

### SWAP
```mermaid
flowchart LR
    S[STARTED<br/><i>Preparing swap transaction</i>] --> AR[ACTION_REQUIRED<br/><i>Sign swap transaction</i>]
    AR --> MR[MESSAGE_REQUIRED<br/><i>Sign swap message</i>]
    AR --> P[PENDING<br/><i>Waiting for swap transaction</i>]
    MR --> P
    P --> D[DONE<br/><i>Swap completed</i>]
```

### CROSS_CHAIN
```mermaid
flowchart LR
    S[STARTED<br/><i>Preparing bridge transaction</i>] --> AR[ACTION_REQUIRED<br/><i>Sign bridge transaction</i>]
    AR --> MR[MESSAGE_REQUIRED<br/><i>Sign bridge message</i>]
    AR --> P[PENDING<br/><i>Waiting for bridge transaction</i>]
    MR --> P
    P --> D[DONE<br/><i>Bridge transaction confirmed</i>]
```

### RECEIVING_CHAIN
```mermaid
flowchart LR
    P[PENDING<br/><i>Waiting for destination chain</i>] --> D[DONE<br/><i>Bridge completed</i>]
```

> **Note:** `RECEIVING_CHAIN` has no `STARTED` status because it's a passive waiting phase.

### PERMIT
```mermaid
flowchart LR
    S[STARTED<br/><i>Preparing transaction</i>] --> AR[ACTION_REQUIRED<br/><i>Sign permit message</i>]
    AR --> P[PENDING<br/><i>Waiting for permit message</i>]
    P --> D[DONE<br/><i>Permit message signed</i>]
```

## Full Execution Flow

A typical cross-chain swap execution:

```mermaid
sequenceDiagram
    participant User
    participant SDK
    participant Wallet
    participant Blockchain
    participant Bridge

    User->>SDK: executeRoute(route)
    
    Note over SDK: Step 1: Token Allowance
    SDK->>SDK: STARTED
    SDK->>Wallet: Request approval signature
    SDK->>SDK: ACTION_REQUIRED
    Wallet-->>User: Sign approval?
    User->>Wallet: Confirm
    Wallet-->>SDK: Signed transaction
    SDK->>Blockchain: Submit approval tx
    SDK->>SDK: PENDING
    Blockchain-->>SDK: Transaction confirmed
    SDK->>SDK: DONE
    
    Note over SDK: Step 2: Bridge Transaction
    SDK->>SDK: STARTED
    SDK->>Wallet: Request bridge signature
    SDK->>SDK: ACTION_REQUIRED
    Wallet-->>User: Sign bridge?
    User->>Wallet: Confirm
    Wallet-->>SDK: Signed transaction
    SDK->>Blockchain: Submit bridge tx
    SDK->>SDK: PENDING (CROSS_CHAIN)
    Blockchain-->>SDK: Transaction confirmed
    SDK->>SDK: DONE (CROSS_CHAIN)
    
    Note over SDK: Step 3: Receiving Chain
    SDK->>SDK: PENDING (RECEIVING_CHAIN)
    SDK->>Bridge: Poll status
    Bridge-->>SDK: Transfer complete
    SDK->>SDK: DONE (RECEIVING_CHAIN)
    
    SDK-->>User: Route execution complete
```

## Error Recovery

```mermaid
flowchart TD
    F[FAILED] --> R{Retry?}
    R -->|Yes| P[PENDING]
    R -->|No| C[CANCELLED]
    P --> S{Success?}
    S -->|Yes| D[DONE]
    S -->|No| F
```

When a transaction fails:
1. Status moves to `FAILED`
2. User can retry with `resumeRoute()`
3. Status transitions back to `PENDING`
4. If successful, moves to `DONE`
5. If it fails again, returns to `FAILED`

## Related Files

- `src/core/execution.ts` - Main execution logic
- `src/core/statusManager/StatusManager.ts` - Status management
- `src/core/statusManager/transitions.ts` - Valid state transitions
- `src/core/processMessages.ts` - Status messages
- `src/types/core.ts` - Type definitions
