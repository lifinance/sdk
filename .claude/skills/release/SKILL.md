---
name: release
description: >-
  How this monorepo actually publishes: the stable-vs-beta pre-mode toggle, the
  per-PR `release-preview` label that cuts a throwaway npm build, the
  `changeset:prepublish` transform that `changeset publish` will NOT run for you,
  and the Linear release anchor. Use this whenever the user asks about releasing,
  publishing, cutting a version, dist-tags, `latest`/`beta`/`preview`, entering or
  exiting pre-mode, sharing an unmerged build with another team, or is debugging
  the `publish.yaml` pipeline. NOT for authoring changesets or picking a bump —
  that's the `changeset` skill.
---

# Releasing

Releases use **Changesets** (independent versioning). Lerna and standard-version are gone.
The pipeline lives in `.github/workflows/publish.yaml` and runs on push to `main`; read it
for the current job graph rather than trusting a copy here.

For *authoring* a changeset and choosing the bump level, use the **`changeset` skill** —
this skill starts where that one ends.

## Versioning: stable 4.x line (pre-mode exited)

- The repo has **exited** Changesets pre-mode and cut **stable `4.0.0`** (now the npm
  `latest` dist-tag). There is no `.changeset/pre.json`, so normal `changeset version` runs
  produce stable semver bumps — no beta suffix, no dist-tag regression to guard against.
- To start a **new beta cycle**, re-enter pre-mode with `changeset pre enter beta` (recreates
  `.changeset/pre.json`); `changeset pre exit` ends it before cutting the next stable. Both
  move the npm dist-tags, so don't toggle pre-mode casually.

## Preview releases (per-PR, opt-in)

To share an unmerged PR build with other teams or external integrators, add the
**`release-preview`** label to the PR. The `preview` job in `publish.yaml` publishes a
throwaway `0.0.0-preview-<sha>` build of the changed packages to npm under the
**`preview`** dist-tag and comments the exact install command on the PR. The label is
removed after a successful publish (one-shot — re-add it to cut another preview).

- Install the **exact** version it prints (e.g. `npm i @lifi/sdk@0.0.0-preview-<sha>`);
  `@preview` moves with the newest preview across PRs. `0.0.0` can never become `latest`/`beta`.
  The `<sha>` is the PR head's short commit hash, so the version traces to the exact source.
- `--snapshot` is disallowed while in pre mode. The repo is on the **stable line** (no
  `.changeset/pre.json`), so snapshotting works directly. As a safeguard the preview action
  still runs `changeset pre exit` **only if** a `pre.json` is present, in the **throwaway CI
  checkout only** (never committed or pushed) — so a future beta cycle won't break previews.
- Guardrails: applying a label requires Triage+ on the repo, so external people / fork-PR
  authors can't trigger it; the same-repo guard means the published code was pushed by
  someone with Write access (forks excluded); and the job is isolated (no Linear secrets).
  This is GitHub's native label-permission gate — no in-workflow role check.

## The publish transform runs from `changeset:prepublish`, not from publish

**Critical:** `changeset publish` does flat per-package `npm publish` and does **not** run
`build:prerelease`, so the transform must run in `changeset:prepublish` (which is why
`changeset:publish` chains the two). Per package:

- `build` writes the dual `dist/{cjs,esm}/package.json` proxy files.
- `build:prerelease` runs `scripts/prerelease.js` → `formatPackageJson.js#formatPackageFile()`,
  which strips `scripts`/`devDependencies`/`workspaces`/`nyc` from the **published**
  `package.json` in place (writing a `package.json.tmp` backup), then copies `README.md`.
  Restore (`postrelease.js`) is intentionally **not** run in CI.
- `scripts/version.js` inlines package name/version into `src/version.ts`.

## `src/version.ts` is regenerated during `changeset version`

`changeset:version` runs the root **`build:version`** script right after `changeset version`
and before `pnpm check:write`, so the Version PR carries the regenerated `src/version.ts`
alongside the bumped `package.json`. Without that step the committed files fell one release
behind per bumped package — the published artifacts were always correct (`changeset:prepublish`
runs `build`, which regenerates them), but git was not, and every local `build` dirtied the
tree.

`build:version` uses `pnpm -r … exec node ../../scripts/version.js` rather than a per-package
`build:version` script, because `pnpm -r run` silently **skips** packages that don't declare
the script — which is how `sdk-provider-tron` was missed.

## Changesets v3 notes

- **`format: false` is required, not cosmetic.** The v3 default (`format: "auto"`) skips Biome
  when versioning and falls through to the tracked root `.prettierrc`, then fails the job with
  `pnpm exec prettier … exited with a non-zero status (1)` because prettier isn't installed.
  Formatting is `pnpm check:write`'s job at the end of `changeset:version`.
- **`changeset version` exits 1 when no changesets exist.** Any unconditional call needs a
  guard — see the `Check for changesets` step in `.github/actions/preview-publish/action.yml`.
- `changesets/action` v2 reads published packages from the `CHANGESETS_OUTPUT` file it injects
  into the publish script's environment. Keep that env var flowing through
  `changeset:publish` → `changeset publish`, or GitHub releases and git tags are silently
  skipped. Do **not** set `env: GITHUB_TOKEN` on the action — v2 throws on a mismatch, and it
  injects its own token into the version/publish script env already.

## Linear anchor coverage policy = SKIP

- The only anchor is `@lifi/sdk` → Linear release name "SDK", secret
  `LINEAR_RELEASE_ACCESS_KEY`. A **provider-only** release cycle won't bump `@lifi/sdk`,
  so the "SDK" Linear release is **skipped** for that cycle. There is no fallback anchor —
  provider-only releases are deliberately not reflected in Linear.
