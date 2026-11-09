# Research a major bump

Do this for each entry in `needsApproval`: an npm major, a `0.x` minor, or a GitHub Action
major. The user needs enough facts to say yes or no without reading the changelog. Report
what breaks for the usage in this repo. Do not copy the upstream release notes.

Research the plan's `target`, not `registryLatest`. A newer version that the gate holds
back does not land in this PR.

## Where to look

1. **The GitHub releases between the two versions.** Read every release from the version
   after `current` to `target`. A breaking change often comes in an intermediate release.
   Find the repo with `npm view <pkg> repository.url homepage`. Then read
   `gh release list --repo <org>/<repo>` and `gh release view <tag> --repo <org>/<repo>`.
   In a monorepo, the changelog can be in a package subfolder.
2. **The `CHANGELOG.md` of the package**, from the repo or from the published tarball.
   Some packages (for example `react-i18next`) have no GitHub releases. Read the file with
   `gh api repos/<org>/<repo>/contents/CHANGELOG.md -H 'Accept: application/vnd.github.raw'`.
   If you did not read any notes, say so in the report.
3. **A migration guide**, if the project has one.
4. **The usage in this repo.** Search all workspace projects, not only `packages/`:
   ```bash
   git grep -n -E "from '<pkg>(/[^']*)?'|require\('<pkg>" -- ':!**/CHANGELOG.md'
   ```
   A breaking change in an API that the repo does not call does not matter.
5. **For a GitHub Action**, read the inputs and outputs that the workflows use. Also read
   the runtime (for example `node24`) and any change to the default values.
6. **The exports of the target.** Read the `exports` map in the tarball, not only the
   notes: `npm view <pkg>@<target> exports --json`, or `npm pack <pkg>@<target>` into
   `$OUT`. A moved or renamed subpath (for example `@noble/hashes/blake2b` →
   `@noble/hashes/blake2.js`) breaks an import without a note.
7. **The module format.** Do this only if the repo ships a CJS build, for example
   `dist/cjs` in sdk. jumper-widget has none. Is the target ESM-only, or does it raise
   `engines.node`? Then check whether that build requires the package:
   `grep -rn "require(\"<pkg>" packages/*/dist/cjs`. A CJS build that requires an
   ESM-only package is a high risk for consumers on older Node.
8. **The peers around it.** Run `pnpm why <pkg>`. For each package that depends on it, read
   `npm view <dependent> peerDependencies`. A peer range can refuse the target. An example
   is `@solana/wallet-adapter-base` with `@solana/web3.js: ^1.99.0`. The major then adds a
   second copy or a peer conflict. The script's `requires` field links majors
   that need each other. Present them as one decision.

9. **The copies for each published package.** A runtime major of a package that also
   comes in transitively (for example `@noble/hashes` from `viem`) can add a second copy.
   Count the versions in the lockfile before and after. Then check each published package
   that uses it: `pnpm --filter <pkg> why <dep>`. A consumer that installs one provider
   gets the copies of that provider only. Report each new copy and its size. A second
   copy of a stateless package costs size only. A second copy of a stateful package (a
   registry, a context, or `instanceof` checks) can break at runtime.

Use primary sources. If you cannot find the breaking changes, write "No changelog found.
The risk is unknown." Do not guess.

10. **A trial.** Release notes do not know this repo. Install the target in the worktree
   (`pnpm -C "$WT" up -r --latest <pkg>`), run `pnpm -r --parallel --no-bail check:types`
   and the tests, then revert (`git checkout -- . && pnpm install --frozen-lockfile`).
   Report the real errors. A trial found 4 type errors in the i18next 27 bump that the
   notes did not name.
11. **A major that only the lockfile brings.** This is a transitive major in the step-3
   preview. Name its cause from the report. Say whether it is dev-only, optional, or a
   prerelease. Ask the user like for any other major.

## Report (one block for each package)

```markdown
### `<pkg>` <current> → <target> (<runtime/dev/action>)

**Breaking changes that touch this repo:**
- <change>: <the import or API and the project that uses it, or "not used here">

**Migration:** <the steps, or "No code change is necessary.">

**Risk:** low / medium / high. <one sentence why>
**Source:** <link to the release notes or the migration guide>
```

Keep the block short. A major can have many breaking changes while the repo uses one API.
Then give that one first, and say that the others do not apply.

## After the decision

- **Small migration** (a rename, a moved import, a changed option): make the edit in the
  commit of that bump. Make sure the build and the tests pass.
- **Large migration** (an API redesign, a change of behavior): do not do it in a bump PR.
  Revert that package. Report it as deferred, with a short description of the work.
