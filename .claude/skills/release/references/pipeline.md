# Pipeline — sdk (`.github/workflows/publish.yaml`)

Trigger: **`push: main`** (not tags). `concurrency: release-${{ github.ref }}`,
`cancel-in-progress: false`.

## Jobs

1. **verify** — reuses `tests.yaml` (via `workflow_call`) as the release gate (build + test).
2. **changesets** — `changesets/action` with `version: pnpm changeset:version`. Opens/
   refreshes the **"chore: version packages"** PR (bumps versions, regenerates per-package
   `CHANGELOG.md`, refreshes the lockfile). Outputs `hasChangesets`.
3. **release** — runs only when `hasChangesets == 'false'`. Runs `publish: pnpm
   changeset:publish` + `createGithubReleases: true`; holds `id-token: write` for npm
   provenance (OIDC). Outputs `publishedPackages` (JSON `[{name,version}]`).
4. **linear-meta** + **linear-release** — gated on `@lifi/sdk` in `publishedPackages`; see
   `linear-sync.md`.

Per-package npm publishes, per-package git tags (`@lifi/sdk@x.y.z`, `@lifi/sdk-provider-*`),
and per-package GitHub Releases are all emitted by the single `release` run.

## Why push:main, not tags

`GITHUB_TOKEN`-created tags don't retrigger workflows, and one merge publishing N packages
must produce N tags in **one** run. Tag-as-trigger can't (N tags = N runs). Inverting to
`push: main` + `createGithubReleases` is the wagmi pattern.

## The transform must run in `changeset:publish`

`changeset publish` does a flat per-package `npm publish` and does **not** run each
package's `build:prerelease`. So `changeset:prepublish` (called by `changeset:publish`) runs
`pnpm build` (writes the dual `dist/{cjs,esm}/package.json`) then per-package
`build:prerelease` → `scripts/prerelease.js` → `formatPackageJson.js`, which strips
`scripts`/`devDependencies`/`workspaces` from the published `package.json`. Never call
`changeset publish` bare — it would publish unstripped tarballs.

## OIDC — keep the filename

npm trusted publishing binds to `{repo, workflow_filename, job}`. The trusted-publisher
entry is bound to **`publish.yaml`** — keep that filename. The publish runs in the `release`
job; verify provenance succeeds on the first real publish.

## Rerun idempotency

Re-running `release` after a partial publish is safe: `changeset publish` skips
already-published versions (npm 409); an existing tag/Release is tolerated (422). Note: the
**first** merge of this pipeline is a no-op publish if every package is already at its
current version on npm — `publishedPackages` is empty and Linear is skipped. Expected.
