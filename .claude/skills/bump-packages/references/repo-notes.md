# Repo notes

The skill is the same in the three repos. This file gives hints about the differences. The
repo itself is the source of truth: `pnpm-workspace.yaml`, `package.json`,
`.changeset/config.json`, and `.github/`. If a note here disagrees with the repo, trust the
repo and fix the note. Find the repo from `git remote get-url origin`.

| Item | `lifinance/sdk` | `lifinance/widget` | `jumperexchange/jumper-widget` |
|---|---|---|---|
| Workspace | `packages/*` | `packages/*`, `examples/*`, `e2e` | `packages/*`, `e2e` |
| Extra pnpm projects | `examples/node` (own lockfile) | none | none |
| Unit tests | `pnpm test:unit` (the pre-push hook) | `pnpm test` | `pnpm test` |
| Pre-commit hook | `pnpm pre-commit`: check, check:types, circular-deps, knip | `lint-staged` | `lint-staged` |
| Pre-push hook | `pnpm test:unit` | none | none |
| `pnpm regen` | no `dedupe` at the end | runs `pnpm dedupe` | runs `pnpm dedupe` |
| Generated files (do not commit) | `packages/*/src/version.ts` | `packages/widget/src/config/version.ts`, `packages/widget-light/src/config/version.ts` | `packages/widget/src/config/version.ts` |
| Bundle size | `node scripts/size-measure.mjs` | `node scripts/size-measure.mjs` | `node scripts/size-measure.mjs` |
| CI tools | none | `npx -y wrangler@x.y.z` in `deploy-test-app.yaml` | `WRANGLER_VERSION` in `deploy-test-app.yaml` and `delete-test-app.yaml` |
| Published scope | `@lifi/*` on npm | `@lifi/*` on npm | `@jumperexchange/*` on GitHub Packages (`.npmrc`) |
| PR repo | `lifinance/sdk` | `lifinance/widget` | `jumperexchange/jumper-widget` (not a fork) |

## All repos

- **Earlier holds.** Read the latest merged `chore: bump packages` PR (step 3). Do not trust a
  PR number written here; it gets old after each bump.
- **Fast-track.** Earlier bumps took fresh releases on purpose (the Dynamic SDK 5.9.6 set,
  Next.js 16.4.0, React 19.3.0). The comment above `minimumReleaseAgeExclude` records them.
  See `fast-track.md` for the rules.
- **Strict gate (a policy option for the user).** None of the repos sets
  `minimumReleaseAge`. So pnpm uses its default, which is not strict. If no mature version
  fits, pnpm takes a fresh one. It also adds that version to `minimumReleaseAgeExclude`. Step 6 catches every
  such entry. Setting `minimumReleaseAgeStrict: true` makes pnpm refuse instead. Propose
  it; do not change it in a bump PR.
- **Peer floors.** Earlier bump PRs moved the caret peer floors of the released packages
  to the latest release. Examples are `wagmi` and `@mysten/dapp-kit-react`. The script
  lists the floors that are behind (`peerFloors`). Ask the user before you move them.
- **Exact overrides on transitive packages** (for example `use-sync-external-store` and
  `utf-8-validate`) keep one copy. They are dedupe pins, not holds against an upgrade,
  unless their comment says otherwise.

## sdk

- `@lifi/types` (runtime, in `@lifi/sdk`) and `@lifi/data-types` (dev) are external pins.
  Changesets does not track them. A bump of `@lifi/types` needs a changeset for `@lifi/sdk`.
- Each provider depends on `@lifi/sdk` through `workspace:*`. Do not write cascade-only
  changesets for providers. Changesets bumps them from the dependency graph.
- `examples/node` has its own `pnpm-workspace.yaml` (overrides and
  `minimumReleaseAgeExclude`) and its own lockfile. Bump it in a separate commit
  `chore(examples): bump packages`. Validate it with
  `pnpm -C examples/node install --frozen-lockfile` and `pnpm -C examples/node exec tsc --noEmit`.
- Packages ship a CJS build. An ESM-only major of a runtime dependency is a risk (see
  `breaking-changes.md`).

## widget

- Most `examples/*` pin the published `@lifi/widget`, `@lifi/wallet-management`, and
  `@lifi/widget-provider-*`. Move these pins to the newest published versions.
  `scripts/restore-example-versions.sh` reverts the example entries in the version PR.
- `@lifi/widget-checkout` is private, but Changesets versions it (`privatePackages.version`
  is true and it is not in `ignore`). It needs a changeset for its runtime bumps.
- Example-only holds are common: an example can exist to show an older major (for example
  `examples/nextjs15` for Next.js 15). The plan then has a separate entry for that version,
  and `upCommands` filters the other projects.
- e2e: `pnpm e2e` runs the playground suite. `pnpm test:example <name>` runs one example.
  `e2e/examples.json` lists the examples and their status.
- `@lifi/sdk`, `@lifi/types`, and `wagmi` must each have one copy in each app. The
  `privy` examples carry a known `wagmi` 2 copy.

## jumper-widget

- A private fork of the widget. Its packages are `@jumperexchange/*`. The `@lifi/sdk` and
  `@lifi/types` dependencies come from public npm.
- `@lifi/sdk` and the `@lifi/sdk-provider-*` packages must move together. Each provider pins
  one exact `@lifi/sdk`. Check `pnpm why @lifi/sdk` for one version.
- `@creit.tech/stellar-wallets-kit` must have one copy (`pnpm why`).
- e2e: `pnpm e2e` (preview build) and `pnpm e2e:dev` (smoke subset).
- `WRANGLER_VERSION`: the deploy workflows read `wrangler pages deployment list --json`.
  Before a wrangler bump, check in its changelog that the JSON keys did not change.
