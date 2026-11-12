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
  "fastTrackMinAgeHours": 6
}
```

- `heldMajors`: majors that the user declined. The script lists each one under "Waiting or
  held" with the reason, and does not ask again. `projects` is optional: it lists workspace
  package names (the `name` in each `package.json`). Without it, the entry applies to every
  project. Patches and minors still land. Write the reason so that a
  later reader knows when to remove the entry.
- `fastTrackMinAgeHours`: the minimum age for an automatic fast-track (default 6). The
  script reads this value from `main`, so a change applies after it is merged.
- The script reads `heldMajors` from the bump branch. Each entry needs `name` and `reason`.
  An unknown key stops the run (exit 2), so that a typing error does not pass without a
  message.

To hold a package at one exact version, use an exact override with a comment in
`pnpm-workspace.yaml`, not this file.

## Single-copy packages

`@lifi/sdk`, `@lifi/types`, `wagmi`, `viem`, and `@creit.tech/stellar-wallets-kit` must each
have one copy in an app. Two copies break at runtime ("Execution data not found",
`WagmiProviderNotFoundError`, "Please set the wallet first"). The lockfile review stops on
a new second copy. The `privy` examples in widget carry a known second `wagmi` copy.

In jumper-widget, each `@lifi/sdk-provider-*` pins one exact `@lifi/sdk`. They move together.

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

- **Biome minor.** A new formatter (YAML since 2.6) fails `pnpm check` on files that the
  bump did not touch. Keep the old output with options in `biome.json`, for example
  `"yaml": { "formatter": { "quoteStyle": "single", "bracketSpacing": false } }`. A new
  recommended lint rule can fail as an error: make the small code fix, or set the rule to
  `"warn"`. Report new warnings; do not fix them in a bump PR.
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
