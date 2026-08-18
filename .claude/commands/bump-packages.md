---
description: Bump all external npm dependencies to latest and open a "chore: bump packages" PR
---

Bump every external npm dependency in this pnpm workspace to its latest version and open a
`chore: bump packages` PR.

Use the **`bump-packages` skill** to do this. In short:

1. Cut a `chore/bump-packages` branch off an up-to-date `main` (running pnpm via the repo's
   corepack pin, so pnpm 11's default 24h release-age floor is in effect). Bump pnpm itself
   first — `corepack use pnpm@latest` (unconditional; the final `pnpm regen` reaffirms it).
   Capture the `pnpm check:types` baseline first (it can carry a pre-existing failure — don't
   blame the bump for it).
2. Run `node .claude/skills/bump-packages/scripts/analyze-outdated.mjs` to predict the aged
   target per dep (the version pnpm will actually land on under the 24h floor) and classify
   what's outdated: **safe** (patch / >=1.x minor) vs **needs-approval** (majors, and 0.x
   minors — breaking under SemVer). Deps whose newest release is <24h old are held back.
3. Apply the safe bumps with `pnpm up -r --latest <names>` — under pnpm 11's floor this lands
   the aged version and preserves each `^`/`~`/exact prefix. Verify the lockfile matches.
4. For each major / 0.x-minor, research the breaking changes and ask the user per package
   before applying — see the skill's `references/breaking-changes.md`.
5. Run `pnpm regen` to regenerate a fresh lockfile + node_modules, then validate against it
   (`build`, `check`, `check:types` vs baseline, `circular-deps`, `knip`, `test:unit`). Add a
   `fix:` changeset for any **runtime** bump on a publishable package (dev-only bumps get
   none). Stage deliberately (`git add -u` + the changeset — not `-A`), commit
   `chore: bump packages`, push, and open a ready PR.
6. Finish with an overview table of what was bumped to which version, plus the pnpm bump and
   any deferred majors.

$ARGUMENTS
