# Upgrade table and PR body

Write all text for people in Simplified Technical English. Use short sentences, the active
voice, and one term for one thing. Keep technical names exact. A good earlier example is
lifinance/widget#909.

## Upgrade table (step 4 and step 9)

Use one table for all areas. Put the rows in this order: npm runtime (released), npm
runtime (private), npm dev, npm lockfile, GitHub Actions, CI tools, pnpm, Node. Sort by
name inside each area. Use `—` in "To" when nothing changes. A family that moves to the
same version (for example `@dynamic-labs/*`) can use one row. Collapse the actions that
are up to date into one row.

The Plan column is one of: auto, needs approval, held, lockfile regen, too fresh, or
fast-track?. A short note in brackets is allowed.

```markdown
| Area | Package | From | To | Bump | Plan |
|---|---|---|---|---|---|
| npm runtime (released) | `@mysten/sui` | 2.36.0 | 2.39.1 | minor | auto |
| npm runtime (released) | `i18next` + `react-i18next` | 26.5.2 / 17.1.0 | 27.0.1 / 18.0.0 | major | needs approval (go together; if declined: 26.7.2 / 17.1.13) |
| npm runtime (private) | `next` (`examples/nextjs`) | 16.4.2 | 16.4.5 | patch | auto |
| npm dev | `@biomejs/biome` | 2.5.15 | 2.6.6 | minor | auto |
| npm dev | `vite-plugin-node-polyfills` | 0.26.0 | — | — | held: override, 0.28 breaks `pnpm dev` |
| npm dev | `vitest` | 5.1.0 | — | — | too fresh (5.1.1 eligible in ~6h) |
| npm runtime (released) | `viem` | 2.57.16 | 2.57.17 | patch | fast-track? (20h old; security fix GHSA-…; no red flags; set: `viem@2.57.17`) |
| npm lockfile | `viem` (`>=2.52.0`) | 2.57.7 | 2.57.16 | patch | lockfile regen (2.57.17 is <24h) |
| npm lockfile | `preact` (override `>=10.29.1`) | 11.0.1 | 11.2.0 | minor | lockfile regen |
| GitHub Actions | `pnpm/action-setup` | v6.1.0 | v6.1.1 | patch | auto |
| GitHub Actions | 8 other actions | — | — | — | up to date |
| CI tools | `wrangler` (`WRANGLER_VERSION`) | 4.151.1 | 4.158.0 | minor | auto |
| pnpm | `packageManager` | 12.14.0 | 12.18.0 | minor | auto (last commit, regeneration pinned to 12.18.0) |
| Node | CI `node-version` | 26 | — | — | latest LTS is 26 |
```

Under the table, add these lines:

- **Changesets:** `<package>: patch` for each one, or "none (dev-only)". Name the ones
  that apply only if a major is approved.
- **Peer floors behind the latest release:** the list, or "none".
- **Fast-track candidates:** each with red flags, exclude set and recommendation, or "none".
- **Aged-out exclusions to remove:** the list, or "none".
- **Holds rechecked:** one line for each hold, with "stays" or "can be lifted" and the reason.

## PR body (step 8)

Fill the repo's PR template (`.github/pull_request_template.md` or
`.github/workflows/pull_request_template.md`). Use the sections below. Leave out a section
that has no content, except "Validation".

```markdown
## Which Linear task is linked to this PR?

None. This PR is routine dependency maintenance.

## Why was it implemented this way?

This PR moves the dependencies, the GitHub Actions and pnpm to their latest releases that
are older than the 24 h release-age gate.

### Commits

| Commit | Content |
|---|---|
| `chore: allow <pkg>@<ver> past the release-age gate` | Approved fast-tracks |
| `chore: bump packages` | Patch and minor bumps |
| `chore: bump <pkg> to <N>` | Major, <runtime/dev> |
| `chore(examples): bump packages` | <extra pnpm project> |
| `ci: bump GitHub Actions and CI tools` | <N> actions, <tools> |
| `chore: move peer floors to the latest releases` | <N> floors |
| `chore: prune aged-out release-age exclusions` | <N> entries |
| `chore: add changesets for the dependency bump` | <N> patch changesets |
| `chore: bump pnpm to <X> and regenerate the lockfile` | The steps of `regen`, pinned to the aged pnpm |

### Packages

<the npm rows of the upgrade table, with a "Where" column instead of "Plan">

**Package manager**: pnpm <from> → <to>. CI reads pnpm from `packageManager`.

### GitHub Actions

<table: Action | From | To>. The SHA pin and the version comment move together.

### Major bumps and how they were checked

- **`<pkg>` <from> → <to> (<runtime/dev>).**
  - <the breaking changes that touch this repo>
  - <how you checked them: grep, tests, e2e, smoke test>

### Held back on purpose

- **`<pkg>` <version>.** <the reason, and the upstream issue or PR that is still open>

### Allowed past the release-age gate

- **`<pkg>@<version>`** (<age> h old): <reason, with the advisory or issue link>. Checks: same publisher, provenance kept, no new install script, no new dependency. Exclude set: <entries>.

### Release-age gate (`minimumReleaseAgeExclude`)

- **Removed** (aged out): <entries>
- **Held by the gate** (the newest release is younger than 24 h): <pkg version (published time)>

### Lockfile

- Major jumps: <none, or each one with its cause>
- Single-copy packages: <one copy each of …>

### Security

- `pnpm audit`: <N> advisories on `main`, <M> on this branch. <new or removed ones>

## Visual showcase (Screenshots or Videos)

Not applicable. This is a dependency-only change with no UI change.

## Checklist before requesting a review
- [x] I have performed a self-review and testing of my code.
- [x] This pull request is focused and addresses a single problem.

### Validation

- `pnpm install --frozen-lockfile`: pass.
- `pnpm build`: pass.
- `pnpm check`: pass.
- `pnpm check:types`: pass (or: the same errors as `main`).
- `pnpm test` / `pnpm test:unit`: pass, <N> tests (the same count as `main`).
- `pnpm knip:check`, `pnpm check:circular-deps`, `pnpm dedupe --check`: pass.
- `pnpm changeset status`: <result>.
- Bundle size: <result, if the repo measures it>.
- e2e: <result, or "not run" with the reason>.
```
