# Solana E2E harness

Executes real swaps on Solana mainnet. **This spends real money.**

## Setup

Add to the repo-root `.env` (gitignored — never commit it):

```
SOLANA_PK=<base58 private key>
SOLANA_RPC_URLS=https://your-quicknode-url/,https://your-helius-url/
LIFI_API_URL=https://staging.li.quest/v1   # production's shared quota runs out mid-matrix
API_KEY=<staging key>                      # sent as x-lifi-api-key
```

At least one RPC must answer `getBundleStatuses` or the Jito phase cannot run.
For `ChainId.SOL` these URLs replace the LI.FI defaults rather than merging.

Optional: `MAX_SPEND_USD` (default 10), `E2E_USD_PER_LEG` (default 0.5),
`E2E_EXECUTE`.

Running from a git worktree? `.env` resolves against that worktree's root.

## Running

```bash
pnpm --filter @lifi/sdk-provider-solana test:e2e                   # dry run
E2E_EXECUTE=true pnpm --filter @lifi/sdk-provider-solana test:e2e  # real swaps
```

## Safety

1. `E2E_EXECUTE` must be exactly `true`; `1`, `yes` and `TRUE` are dry runs.
2. The `test` script excludes `**/*.e2e.spec.ts`, so `pnpm test` cannot reach
   these files. A bare `vitest --run` matches every spec file, so this is not
   automatic.
3. `MAX_SPEND_USD` is asserted before any broadcast.
4. Legs run sequentially.

## Covers

The Jito bundle path (`sendAndConfirmBundle`, `confirmBundle`,
`SolanaJitoWaitForTransactionTask`), the standard path across 12 pairs,
`txHash`-then-`txLink` ordering, and `raceRpcs` against two live endpoints.

**Not covered:** multi-blockhash bundles (an observed bundle shared one
blockhash), the 90 s ceiling (mainnet confirms in seconds), and
`rpc-unavailable` (needs every endpoint failing at once — to check by hand,
disable networking mid-run and expect code 1027, never 1018).

## Expect failures that are not SDK defects

Four to five of the twelve matrix legs pass; most of the rest fail at
simulation with `InstructionError Custom: 25` (slippage). That is a Titan
quote defect, measured across seven runs:

| aggregator | SOL→USDT | USDC→USDT |
|---|---|---|
| titan | **+33.3%** | **+13.9%** |
| jupiter / fly / dflow | 0.0% | −0.1% |

Titan quotes `1 USDC → 1.1389 USDT` while both price feeds read ~$1.00.
Production shows the same premium. These are rejected before broadcast, so the
confirmation code is never reached.

## Known premise

The bundle phase needs the backend to return a Perena route for PENGU → USD*
when `jitoBundle: true` is set **in the routes options** — not as a query
parameter on `/v1/quote` (422), and not on `stepTransaction` for a single-swap
step (returns one transaction). Phase 1 fails loudly if that stops holding.

USD* is hardcoded to `star9ag…`. A second mint under the same symbol is what
the token API returns; it produces no Perena route.
