# CLAUDE.md

## Project
TypeScript monorepo (pnpm workspaces) with 6 packages under `packages/`. `@lifi/sdk`
is the hub; each provider depends on it via `workspace:*` as a **regular** dependency
(not peer), which resolves to the exact pinned version in published tarballs.
- `@lifi/sdk` — core SDK (no deps on other workspace packages)
- `@lifi/sdk-provider-ethereum` — EVM provider (depends on sdk, uses viem)
- `@lifi/sdk-provider-solana` — Solana provider (depends on sdk, uses @solana/kit)
- `@lifi/sdk-provider-bitcoin` — Bitcoin provider (depends on sdk, uses bitcoinjs-lib)
- `@lifi/sdk-provider-sui` — Sui provider (depends on sdk, ESM-only, no CJS)
- `@lifi/sdk-provider-tron` — Tron provider (depends on sdk, uses tronweb)

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
Releases use **Changesets** (independent versioning). Lerna and
standard-version are gone.

### Per-PR rule (add a changeset to every publishable PR)
- Run `pnpm changeset`, pick the affected package(s), choose a bump:
  - `feat:` → **minor**, `fix:` → **patch**, breaking change → **major**.
- **Skip** a changeset for: docs-only, chore-only, CI/config, tests, examples.
  (`changeset-bot` comments a reminder when publishable source changes with no changeset;
  docs/chore PRs simply don't need one. The Version PR is the real publish gate.)
- Only declare changesets for packages you *intentionally* changed. Do **not** author
  cascade-only changesets for dependents — Changesets bumps providers automatically from the
  dependency graph when `@lifi/sdk` changes. (`updateInternalDependencies: "minor"` only tunes
  the threshold at which a provider's internal `@lifi/sdk` *range* is rewritten — minor/major, not patch.)

### PRE-MODE (beta) — do not exit until cutting stable 4.0.0
- The repo is in Changesets **pre-mode** (`.changeset/pre.json`, `tag: beta`). Latest on
  npm is v3 (`3.16.3`); the repo is mid `4.0.0-beta.x`. A bare `changeset version` would
  jump to a **stable 4.0.0** and regress the dist-tags — pre-mode prevents that, keeping
  versions on `4.0.0-beta.N` and the npm dist-tag on `beta`.
- **Never run `changeset pre exit`** until you are deliberately cutting the stable 4.0.0
  release. Exiting then re-versioning is the only correct way to land stable.

### Pipeline (`.github/workflows/publish.yaml`, push to `main`)
1. `verify` — reuses `tests.yaml` (build + test).
2. `changesets` — opens/refreshes the "chore: version packages" PR
   (`pnpm changeset:version`). Merging it lands the version bumps.
3. `release` — runs only when `hasChangesets == 'false'`; `pnpm changeset:publish`
   + `createGithubReleases: true`. Holds `id-token: write` for npm provenance.
4. `linear-release` — single **static** anchor: only when `@lifi/sdk` is in
   `release.outputs.publishedPackages` does it sync the "SDK" Linear release.

### Preview releases (per-PR, opt-in)

To share an unmerged PR build with other teams or external integrators, add the
**`release-preview`** label to the PR. The `preview` job in `publish.yaml` publishes a
throwaway `0.0.0-preview-<sha>` build of the changed packages to npm under the
**`preview`** dist-tag and comments the exact install command on the PR. The label is
removed after a successful publish (one-shot — re-add it to cut another preview).

- Install the **exact** version it prints (e.g. `npm i @lifi/sdk@0.0.0-preview-<sha>`);
  `@preview` moves with the newest preview across PRs. `0.0.0` can never become `latest`/`beta`.
  The `<sha>` is the PR head's short commit hash, so the version traces to the exact source.
- This repo is in **pre mode**, where `--snapshot` is disallowed — the job therefore runs
  `changeset pre exit` in the **throwaway CI checkout only** (never committed or pushed)
  before snapshotting. `.changeset/pre.json` on the branch is untouched.
- Guardrails: applying a label requires Triage+ on the repo, so external people / fork-PR
  authors can't trigger it; the same-repo guard means the published code was pushed by
  someone with Write access (forks excluded); and the job is isolated (no Linear secrets).
  This is GitHub's native label-permission gate — no in-workflow role check.

### Root scripts
- `changeset:version` — `changeset version` + `pnpm install --lockfile-only` + `pnpm check:write`.
- `changeset:prepublish` — `pnpm build` then per-package `build:prerelease`
  (the publish transform). **Critical:** `changeset publish` does flat per-package
  `npm publish` and does **not** run `build:prerelease`, so the transform must run here.
- `changeset:publish` — `pnpm changeset:prepublish && changeset publish`.

### Publish transform (per package)
- `build` writes the dual `dist/{cjs,esm}/package.json` proxy files.
- `build:prerelease` runs `scripts/prerelease.js` → `formatPackageJson.js#formatPackageFile()`,
  which strips `scripts`/`devDependencies`/`workspaces`/`nyc` from the **published**
  `package.json` in place (writing a `package.json.tmp` backup), then copies `README.md`.
  Restore (`postrelease.js`) is intentionally **not** run in CI.
- `scripts/version.js` inlines package name/version into `src/version.ts` at build time.

### Linear anchor coverage policy = SKIP
- The only anchor is `@lifi/sdk` → Linear release name "SDK", secret
  `LINEAR_RELEASE_ACCESS_KEY`. A **provider-only** release cycle won't bump `@lifi/sdk`,
  so the "SDK" Linear release is **skipped** for that cycle. There is no fallback anchor —
  provider-only releases are deliberately not reflected in Linear.

### External pinned deps — bump MANUALLY (out of Changesets scope)
- `@lifi/types` (17.x, in `@lifi/sdk` deps) and `@lifi/data-types` (devDep) are external
  pinned versions. Changesets does **not** track or bump them. When upgrading, edit the
  pins by hand and add a `fix:`/`feat:` changeset describing the bump.

## pnpm config
- pnpm 11 only reads `pnpm-workspace.yaml`; `pnpm.overrides` in `package.json` and non-auth `.npmrc` settings are silently ignored
- After moving/changing overrides, run `pnpm install --lockfile-only` and grep the lockfile to confirm — "Already up to date" can be misleading
- Verify a setting is applied: `pnpm config get <kebab-name>` returns `undefined` if pnpm isn't reading it
- Publish provenance comes from `NPM_CONFIG_PROVENANCE: true` env in `.github/workflows/publish.yaml` (not a valid pnpm-workspace.yaml field)
