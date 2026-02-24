---
name: code-review
description: Review local code changes for quality, maintainability, and correctness before pushing. Use to catch issues early — before a PR is created. Focuses on safety, API design, patterns, and actionable feedback.
---

Review local changes as an expert web3 SDK TypeScript developer (viem, wagmi, Solana, Sui, Ethereum, Bitcoin).

## Process

1. Run `git diff` and `git diff --staged`. Read commit messages. If specific files provided, start there.
2. Read surrounding code to understand intent. Check if tests exist and cover new behavior.
3. Triage by risk: small changes → review deeply. Large changesets → prioritize safety-critical paths and public API first.
4. Skip what Biome (lint/format), Knip (unused exports), and Madge (circular deps) already catch.

## Checklist (by priority)

1. **DeFi safety** — BigInt/decimal precision, token amounts/decimals/conversions, slippage/gas/balance checks, partial execution safety, chain-specific address validation
2. **Security** — no keys/wallet data in logs/errors, RPC/URL validation, safe serialization, boundary validation of addresses/amounts/chainIds
3. **Logic** — correctness, boundary conditions, async handling (races, awaiting), memory leaks
4. **Public API** — flag breaking changes to exports/types/interfaces, naming consistency, changelog-worthy changes. Alpha: breaking is OK but must be intentional
5. **Types & errors** — avoid `any`, handle null/undefined, justify `as` assertions. Use custom errors (`SDKError`, `RPCError`, `ProviderError`, `TransactionError`, `BalanceError`, `ValidationError`, `HttpError`, `ServerError`, `UnknownError`)
6. **Package boundaries** — `@lifi/sdk-provider-*` must not import `@lifi/sdk` internals, cross-package deps declared in `package.json`, chain-specific code in provider packages
7. **Performance** — unnecessary deps/bundle bloat, tree-shakeability, memoization opportunities
8. **Conventions** — `.js` import extensions, no `console.log` (only warn/error/debug), no barrel files, braces on control flow, CJS+ESM compatible, tests named `.unit.spec.ts`

## Output

Be specific and actionable. Explain impact. Suggest solutions. No generic feedback or bikeshedding.

**Must Fix** — bugs, security, breaking changes, fund safety
**Should Fix** — correctness, API design, maintainability
**Consider** — performance, naming, simplification
**Looks Good** — well-written code worth calling out

Omit empty categories. Max 5 items each. One sentence per issue. Code examples for must-fix only. Each item: file:line, description, suggested fix.

End with **Verdict**: "Ready to push", "Needs changes", or "Needs discussion".
