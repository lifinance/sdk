# CLAUDE.md

## Project
TypeScript monorepo (pnpm workspaces) with 5 packages under `packages/`:
- `@lifi/sdk` — core SDK (no external deps on other packages)
- `@lifi/sdk-provider-ethereum` — EVM provider (depends on sdk, uses viem)
- `@lifi/sdk-provider-solana` — Solana provider (depends on sdk, uses @solana/kit)
- `@lifi/sdk-provider-bitcoin` — Bitcoin provider (depends on sdk, uses bitcoinjs-lib)
- `@lifi/sdk-provider-sui` — Sui provider (depends on sdk, ESM-only, no CJS)

## Build
- `pnpm build` — runs tsdown in all packages in parallel (no dependency ordering needed)
- `pnpm check` — biome lint/format
- `pnpm check:types` — tsc --noEmit (separate from build)
- Build outputs: `dist/esm/` (ESM + .d.ts), `dist/cjs/` (CJS only, not for sui)
- tsdown configs in each package root (`tsdown.config.ts`)
- `isolatedDeclarations: true` — all exports need explicit return type annotations

## Testing & CI
- `pnpm test:unit` — vitest unit tests
- `pnpm pre-commit` — runs check + check:types + circular-deps + knip (via husky)
- `pnpm pre-push` — runs unit tests (via husky)

## Code Style
- Biome for formatting and linting (`pnpm check:write` to auto-fix)
- No default exports in library code
- Import types with `import type` syntax

## Known Issues
- `sdk-provider-ethereum/src/errors/parseEthereumErrors.ts` — pre-existing TS2339 error in check:types
- `sdk-provider-ethereum/src/utils/abi.ts` — parseAbi results typed as `Abi` (broader than inferred); downstream code uses `as` casts for readContract results

## Release
- `pnpm release` → `pnpm release:publish` (uses lerna + standard-version)
- Pre-publish strips devDependencies via `scripts/prerelease.js`, restores via `scripts/postrelease.js`
- `scripts/version.js` inlines package name/version into `src/version.ts` at build time

## pnpm config
- pnpm 11 only reads `pnpm-workspace.yaml`; `pnpm.overrides` in `package.json` and non-auth `.npmrc` settings are silently ignored
- After moving/changing overrides, run `pnpm install --lockfile-only` and grep the lockfile to confirm — "Already up to date" can be misleading
- Verify a setting is applied: `pnpm config get <kebab-name>` returns `undefined` if pnpm isn't reading it
- Publish provenance comes from `NPM_CONFIG_PROVENANCE: true` env in `.github/workflows/publish.yaml` (not a valid pnpm-workspace.yaml field)
