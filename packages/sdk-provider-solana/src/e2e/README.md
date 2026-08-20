# Solana E2E harness

Executes real swaps on Solana mainnet against real RPCs. **This spends real
money.**

## Setup

Add to the repo-root `.env` (gitignored — never commit it):

```
SOLANA_PK=<base58 private key>
SOLANA_RPC_URLS=https://your-quicknode-url/,https://your-helius-url/
```

At least one URL must answer `getBundleStatuses`, or the Jito phase cannot
run. For `ChainId.SOL` these URLs **replace** the LI.FI defaults rather than
merging with them, so the list must be complete on its own.

Optional:

```
MAX_SPEND_USD=10      # ceiling asserted before any broadcast (default 10)
E2E_EXECUTE=true      # required before anything is broadcast
```

Running from a git worktree? `.env` is resolved relative to that worktree's
root, not the main checkout — copy the file across or the suite skips.

## Running

Dry run — quotes, route building and shape assertions, no broadcast:

```bash
pnpm --filter @lifi/sdk-provider-solana test:e2e
```

Real execution:

```bash
E2E_EXECUTE=true pnpm --filter @lifi/sdk-provider-solana test:e2e
```

## Safety model

Four independent guards:

1. `E2E_EXECUTE` must be the exact string `true`. `1`, `yes` and `TRUE` are
   all treated as a dry run, and a spec pins each of them.
2. The package `test` script excludes `**/*.e2e.spec.ts`, so `pnpm test`
   cannot reach these files. This is not automatic — a bare `vitest --run`
   matches every spec file, and a canary proved it did before the exclusion
   was added.
3. `MAX_SPEND_USD` is asserted against the summed planned spend.
4. Legs run sequentially, so a runaway loop cannot fan out.

## What this covers

- The Jito bundle path: `sendAndConfirmBundle`, `confirmBundle`,
  `SolanaJitoWaitForTransactionTask` — none of which had ever executed
  against a live Jito-capable endpoint.
- The standard path across 12 token pairs.
- `txHash` written at signing, `txLink` deferred until broadcast — asserted
  by observed order, not by final state.
- `raceRpcs` against two live endpoints concurrently.

## What it does not cover

- **Multi-blockhash bundles.** Both transactions in an observed live bundle
  shared one blockhash, so the per-blockhash streak logic in
  `createConfirmationDeadline` stays unexercised.
- **The 90 s ceiling and expiry.** A healthy mainnet confirms in seconds.
- **`rpc-unavailable`.** Requires every endpoint failing at once. To check it
  by hand: start a run, then disable networking mid-confirmation. The error
  should be `RPCError` with code 1027, never `TransactionExpired` (1018).

## Known premise

The bundle phase depends on the backend returning a Perena route for
PENGU → USD* when `jitoBundle: true` is set **in the routes options**. Not as
a query parameter on `/v1/quote`, which returns 422, and not on
`stepTransaction` for a single-swap step, which returns one transaction.

If that stops holding, Phase 1 fails loudly by design. It must never quietly
fall back to the standard path and report success for code that never ran.

USD* is hardcoded to `star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM`. A second
mint circulates under the same symbol and is what the token API returns; it
does not produce the Perena route, so resolving USD* by symbol silently
disables the bundle test.
