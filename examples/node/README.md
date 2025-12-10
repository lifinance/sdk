# LI.FI SDK Node.js Examples

This directory contains example scripts demonstrating various features of the `@lifi/sdk` package.

## Prerequisites

1. Copy `.env-template` to `.env` and add your private key:
   ```bash
   cp .env-template .env
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Ensure your wallet has small amounts of tokens on the respective chains.

## Examples Overview

| Script | Description | Chains | Approx. Cost |
|--------|-------------|--------|--------------|
| `swap.ts` | Same-chain token swap | Optimism | ~$0.10 |
| `bridge.ts` | Cross-chain token bridge | Optimism → Arbitrum | ~$0.10 |
| `multihop.ts` | Multi-hop bridge with intermediate chain | Arbitrum → Polygon → Optimism | ~$0.10 |
| `toAmount.ts` | Bridge with exact output amount | Arbitrum → Optimism | ~$0.10 |
| `klimaRetireExactCarbon.ts` | Carbon offset via Klima DAO | Optimism → Polygon | ~$0.10 |
| `polynomialDeposit.ts` | DeFi deposit to Polynomial | Arbitrum → Optimism | ~$0.40 |
| `yearnDeposit.ts` | DeFi deposit to Yearn vault | Arbitrum → Polygon | ~$0.40 |

---

## Script Details

### `swap.ts` - Same-Chain Token Swap

**What it tests:** Basic token swap on a single chain using `getRoutes` and `executeRoute`.

**Flow:**
1. Creates an SDK client with EthereumProvider
2. Requests a route for USDC → USDT swap on Optimism
3. Executes the route with automatic transaction handling

**Key SDK features:**
- `createClient()` - Initialize SDK
- `getRoutes()` - Get swap/bridge routes
- `executeRoute()` - Execute a route with full lifecycle management

**Run:** `pnpm example:swap`

---

### `bridge.ts` - Cross-Chain Token Bridge

**What it tests:** Bridging tokens between two different chains with chain switching.

**Flow:**
1. Creates SDK client with `switchChain` callback for multi-chain support
2. Requests a route for USDC bridge from Optimism to Arbitrum
3. Executes the bridge with automatic chain switching if needed

**Key SDK features:**
- `EthereumProvider({ switchChain })` - Handle chain switching during execution
- Cross-chain route execution

**Run:** `pnpm example:bridge`

---

### `multihop.ts` - Multi-Hop Bridge

**What it tests:** Complex bridging scenario using contract calls to chain multiple bridges.

**Flow:**
1. Gets a quote for the second bridge leg (Polygon → Optimism)
2. Creates a contract calls quote that bridges to Polygon AND executes the second bridge
3. Manually sends the transaction and polls for status

**Key SDK features:**
- `getQuote()` - Get a single-step quote
- `getContractCallsQuote()` - Get quote with destination contract calls
- `getStatus()` - Poll transaction status
- Manual transaction execution (without `executeRoute`)

**Run:** `pnpm example:multihop`

---

### `toAmount.ts` - Exact Output Amount

**What it tests:** Bridging with a specific target output amount (reverse quote).

**Flow:**
1. Requests a quote where `toAmount` is specified instead of `fromAmount`
2. SDK calculates required input amount
3. Executes the transaction manually

**Key SDK features:**
- `getContractCallsQuote({ toAmount })` - Reverse quote calculation
- Token allowance checking and setting

**Run:** `pnpm example:toAmount`

---

### `klimaRetireExactCarbon.ts` - Carbon Offset Integration

**What it tests:** Cross-chain contract call to Klima DAO for carbon retirement.

**Flow:**
1. Reads Klima contract to calculate required token amount
2. Encodes the `retireExactCarbonDefault` function call
3. Creates a contract calls quote that bridges tokens AND retires carbon
4. Executes and monitors the transaction

**Key SDK features:**
- `getContractCallsQuote({ contractCalls })` - Execute arbitrary contract calls on destination
- Integration with external DeFi protocols

**Run:** `pnpm example:klima`

---

### `polynomialDeposit.ts` - DeFi Protocol Deposit

**What it tests:** Cross-chain deposit into Polynomial Earn vault.

**Flow:**
1. Encodes `initiateDeposit` function call for Polynomial contract
2. Creates quote to bridge sETH to Optimism and deposit in one transaction
3. Executes and monitors

**Key SDK features:**
- Cross-chain DeFi integrations
- Contract call encoding with destination protocol

**Run:** `pnpm example:polynomial`

---

### `yearnDeposit.ts` - Yearn Vault Deposit

**What it tests:** Cross-chain deposit into Yearn Finance vault.

**Flow:**
1. Encodes `deposit` function call for Yearn vault
2. Creates quote to bridge WETH to Polygon and deposit
3. Handles both same-chain and cross-chain scenarios

**Key SDK features:**
- Yearn protocol integration
- Conditional status polling (skipped for same-chain)

**Run:** `pnpm example:yearn`

---

## Utility Files

### `utils/checkTokenAllowance.ts`
Helper to check and set ERC20 token allowances before transactions.

### `utils/transformTxRequestToSendTxParams.ts`
Transforms SDK transaction request format to viem's `sendTransaction` parameters.

### `helpers/promptConfirm.ts`
Interactive confirmation prompt before executing transactions.

### `helpers/reportStepsExecutionToTerminal.ts`
Callback to log execution progress to the terminal.

---

## Safety Notes

⚠️ **These examples execute REAL transactions on mainnet chains.**

- All amounts are intentionally small (~$0.10-0.40)
- Each script prompts for confirmation before executing
- Use a dedicated test wallet with minimal funds
- Review the route details before confirming
