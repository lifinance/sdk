# prepareUpdatedStep flow

```mermaid
flowchart TB
  subgraph entry["prepareUpdatedStep"]
    A["stepBase = step without execution"]
    A --> B["fetchUpdatedStepByType(client, step, stepBase, signedTypedData, deps)"]
  end

  subgraph fetchType["fetchUpdatedStepByType"]
    B --> C{"Step type?"}
    C -->|"Contract call"| D["fetchContractCallStep"]
    C -->|"Relayer + gasless"| E["fetchRelayerStep"]
    C -->|"Else"| F["fetchStandardStep"]
  end

  subgraph contractCall["fetchContractCallStep"]
    D --> D1["getContractCalls (executionOptions)"]
    D1 --> D2{"contractCalls?"}
    D2 -->|"None"| Derr["Throw TransactionUnprepared"]
    D2 -->|"Yes"| D3{"patcher?"}
    D3 -->|"Yes"| D4["patchContractCalls"]
    D3 -->|"No"| D5["getContractCallsQuote"]
    D4 --> D5
    D5 --> D6["Apply toolDetails if contractTool"]
    D6 --> D7["convertQuoteToRoute → step with id"]
  end

  subgraph relayer["fetchRelayerStep"]
    E --> E1["getRelayerQuote (allowBridges: step.tool)"]
    E1 --> E2["Return step with id"]
  end

  subgraph standard["fetchStandardStep"]
    F --> F1["Filter signedTypedData (with signature)"]
    F1 --> F2["getStepTransaction(client, params)"]
  end

  D7 --> G
  E2 --> G
  F2 --> G

  subgraph merge["prepareUpdatedStep (continued)"]
    G["updatedStep"]
    G --> H["stepComparison(statusManager, step, updatedStep, …)"]
    H --> I["Object.assign(step, comparedStep, execution, typedData)"]
    I --> J{"transactionRequest or typedData?"}
    J -->|"Neither"| Jerr["Throw TransactionUnprepared"]
    J -->|"At least one"| K["buildTransactionRequest(client, step, action, deps)"]
  end

  subgraph buildTx["buildTransactionRequest"]
    K --> K1{"step.transactionRequest?"}
    K1 -->|"No"| Kret1["return undefined"]
    K1 -->|"Yes"| K2{"account type local?"}
    K2 -->|"Yes"| K3["checkClient(step, action)"]
    K3 --> K4{"updatedClient?"}
    K4 -->|"No"| Kret2["return null (abort)"]
    K4 -->|"Yes"| K5["getMaxPriorityFeePerGas(client, updatedClient)"]
    K2 -->|"No"| K6["maxPriorityFeePerGas from step.transactionRequest"]
    K5 --> K7["Build TransactionParameters"]
    K6 --> K7
    K7 --> Kret3["return request"]
  end

  Kret1 --> L
  Kret2 --> Lnull
  Kret3 --> L

  subgraph exit["prepareUpdatedStep (exit)"]
    L["builtRequest"]
    L --> Lcheck{"builtRequest === null?"}
    Lcheck -->|"Yes"| Lnull["return null"]
    Lcheck -->|"No"| L1{"updateTransactionRequestHook?"}
    L1 -->|"Yes"| L2["Run hook, merge customized request"]
    L1 -->|"No"| L3["transactionRequest = builtRequest"]
    L2 --> L3
    L3 --> L4["return { transactionRequest, isRelayerTransaction }"]
  end
```

## Step type dispatch

| Condition | Helper | What it does |
|-----------|--------|----------------|
| `isContractCallStep(step)` | `fetchContractCallStep` | Get contract calls (optional patch) → quote → route step |
| `isRelayerStep(step) && isGaslessStep(step)` | `fetchRelayerStep` | Get relayer quote for gasless execution |
| Else | `fetchStandardStep` | getStepTransaction with optional signed typed data |

## Return values

- **prepareUpdatedStep**: `{ transactionRequest, isRelayerTransaction }` or `null` (abort when checkClient fails).
- **buildTransactionRequest**: `undefined` (no tx request), `null` (abort), or `TransactionParameters`.
