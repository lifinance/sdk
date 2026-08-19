# CLAUDE.md

## Project
TypeScript monorepo (pnpm workspaces) with 7 packages under `packages/`. `@lifi/sdk`
is the hub; each provider depends on it via `workspace:*` as a **regular** dependency
(not peer), which resolves to the exact pinned version in published tarballs.

## Build
- `pnpm build` runs all packages in parallel — no dependency ordering needed
- `isolatedDeclarations: true` — all exports need explicit return type annotations

## Code Style
- No default exports in library code

## Known Issues
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
  dependency graph when `@lifi/sdk` changes. (`updateInternalDependencies: "patch"` — the
  default — re-releases every provider on *any* `@lifi/sdk` bump, including a patch, so their
  `workspace:*` pins stay current.)

### Cutting a release

Pre-mode/dist-tags, per-PR `release-preview` builds, the `changeset:prepublish` transform,
and the Linear anchor policy live in the **`release` skill**
(`.claude/skills/release/SKILL.md`). Read it before touching the publish path.

### External pinned deps — bump MANUALLY (out of Changesets scope)
- `@lifi/types` (18.x, in `@lifi/sdk` deps) and `@lifi/data-types` (devDep) are external
  pinned versions. Changesets does **not** track or bump them. When upgrading, edit the
  pins by hand and add a `fix:`/`feat:` changeset describing the bump.

## pnpm config
- pnpm 11 only reads `pnpm-workspace.yaml`; `pnpm.overrides` in `package.json` and non-auth `.npmrc` settings are silently ignored
- After moving/changing overrides, run `pnpm install --lockfile-only` and grep the lockfile to confirm — "Already up to date" can be misleading
- Verify a setting is applied: `pnpm config get <kebab-name>` returns `undefined` if pnpm isn't reading it
- Publish provenance comes from `NPM_CONFIG_PROVENANCE: true` env in `.github/workflows/publish.yaml` (not a valid pnpm-workspace.yaml field)
