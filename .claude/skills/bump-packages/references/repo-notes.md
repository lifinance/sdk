# Repo notes

The script reads the repo itself: the workspace, the scripts, the Changesets config, and
the workflows. This file holds only what the script cannot know.

## Per-repo config: `.claude/bump-packages.json`

The file is optional. It is not part of the skill folder, because each repo has its own.

```json
{
  "heldMajors": [
    {
      "name": "typescript",
      "projects": ["vue", "svelte"],
      "reason": "vue-tsc and svelte-check do not support TypeScript 7. Remove when they do."
    }
  ],
  "fastTrackMinAgeHours": 6,
  "checks": ["test:integration", "test:snapshots"],
  "build": "build:compile"
}
```

- `heldMajors`: majors that the user declined. The script lists each one under "Waiting or
  held" with the reason, and does not ask again. `projects` is optional: it lists workspace
  package names (the `name` in each `package.json`). Without it, the entry applies to every
  project. Patches and minors still land. Write the reason so that a
  later reader knows when to remove the entry.
- `fastTrackMinAgeHours`: the minimum age for an automatic fast-track (default 6). The
  script reads this value from `main`, so a change applies after it is merged.
- `checks`: more `package.json` scripts to run after the build, besides the ones that the
  script finds by name (`build`, `check`, `check:types`, `check:circular-deps`,
  `knip:check`, `test:unit` or `test`). The script runs the union of the list on `main` and
  the list on the branch. A name without a script on `main` and on the branch is skipped.
- `build`: the `package.json` script that the script runs as the build check (default
  `build`). The other checks that need the build wait for it, and `--skip-check` never
  accepts its failure. The script reads this value only from `main`, so that a branch cannot
  choose another script. A name without a script on `main` stops the run (exit 2). Use it
  only when the repo's own build cannot pass on a developer machine.
- A check whose script is on `main` always runs. If the branch removes the script, the
  check fails. If the branch changes the script, the summary has a note. Review that
  change: the branch sets the command that the check runs.
- The script reads `heldMajors` from the bump branch. Each entry needs `name` and `reason`.
  An unknown key stops the run (exit 2), so that a typing error does not pass without a
  message.

To hold a package at one exact version, use an exact override with a comment in
`pnpm-workspace.yaml`, not this file. A selector that pins one exact version and has a comment
(`'zod@>=4.6.6': 4.6.5`) also holds a direct bump into its range.

## Single-copy packages

`@lifi/sdk`, `@lifi/types`, `wagmi`, `viem`, and `@creit.tech/stellar-wallets-kit` must each
have one copy in an app. Two copies break at runtime ("Execution data not found",
`WagmiProviderNotFoundError`, "Please set the wallet first"). The lockfile review stops on
a new second copy. The `privy` examples in widget carry a known second `wagmi` copy.

In jumper-widget, each `@lifi/sdk-provider-*` pins one exact `@lifi/sdk`. They move together.

## jumper-frontend

- The default branch is `develop`. `main` is the production branch, and it is old.
- `check` and `check:types` in `package.json` give the script the lint, format and type
  checks of CI. `check:types` runs `next typegen` first, as CI does. The other test suites
  of CI are in `checks` of `.claude/bump-packages.json`.
- `next build` cannot pass locally: page-data collection needs the env values and calls
  Strapi and the backends. The build check is `build:compile` (`next build
  --experimental-build-mode=compile`): it compiles and type-checks, but it does not
  prerender. CI and the Vercel preview run the full build.
- The "collapse duplicate copies" overrides use caret ranges (for example `viem: ^2.58.1`),
  so that the script moves each one to the newest aged version of its major. An exact pin
  with a reason in its comment is a hold: `@coinbase/cdp-sdk`, `eslint`, `zod` and the
  WalletConnect and Reown family. `@next/env` must match `next`: the two publish together, and
  the script moves both in one run. If you hold `next`, hold `@next/env` too.
- The first-party overrides (`@lifi/sdk`, `@lifi/sdk-provider-ethereum`, and the
  `npm:@jumperexchange/*` aliases) stay exact. Move them by hand, together with
  `@jumperexchange/widget`: read the versions that the new widget release asks for
  (`npm view @jumperexchange/widget@<version> dependencies --registry https://npm.pkg.github.com`).
- `@coinbase/cdp-sdk` 1.53 and later imports optional `@x402/*` peers, which Turbopack
  treats as build errors. Keep the hold until `pnpm build` passes with a newer version.
- The packages from GitHub Packages (`@jumperexchange/*`) need a token in `~/.npmrc`. Never
  copy the token into a worktree, a log, or the PR text.

## e2e runs (only for an approved runtime or UI major)

- widget: `pnpm e2e` (playground), and `pnpm test:example <name>` for one example.
- jumper-widget: `pnpm e2e` (preview build), and `pnpm e2e:dev` (smoke subset).
- The suites call the LI.FI API. Two full runs back to back get HTTP 429. A failure with 429
  in its trace is not a regression: wait some minutes, then run the failed spec files again.
- Compare failures by spec file and test title. Line numbers move.
- Stop your own dev and preview servers first. widget `scripts/test-example.sh` kills each
  process that holds its port.
- After a `@playwright/test` bump, run `pnpm exec playwright install`.

## Known causes of a failed check after a bump

- **Oxfmt or Oxlint version.** The versions are pinned exactly. Bump `oxlint` and `oxfmt`
  together in all five repositories. A new Oxfmt version can change the output of files that
  the bump did not touch, and then `pnpm check` fails. Keep the old output with an option, an
  override or an `ignorePatterns` entry in `.oxfmtrc.json`. A new default lint rule reports
  warnings: report them, but do not fix them in a bump PR. Two cases fail `pnpm check`: a rule
  name in `.oxlintrc.json` that the new version does not know, and an `oxlint-disable` comment
  that the new version no longer needs. Fix the config, or delete the comment.
- **A patch can break a bundler.** `viem` 2.57.16 added a literal dynamic import of an
  optional peer, and the size check failed. The size check is the only local bundler check.
- **A Next.js app.** No check builds `widget-playground-next`. After a `next` bump, run
  `pnpm --filter widget-playground-next build` by hand if the PR must prove it.

## Things a person checks after the script

- **`WRANGLER_VERSION` (jumper-widget) and `npx wrangler@x` (widget).** The deploy workflows
  read the JSON output of `wrangler pages deployment list`. After a wrangler bump, look at
  the test-app deploy job of the PR.
- **sdk CJS build.** The sdk packages ship CommonJS. An ESM-only major of a runtime
  dependency is a risk for consumers (`breaking-changes.md`).
- **Policy options for the repo owner** (propose them; do not change them in a bump PR): an
  explicit `minimumReleaseAge: 1440`, which makes pnpm refuse a fresh version instead of
  adding an exclude entry by itself, and `trustPolicy: no-downgrade`.
