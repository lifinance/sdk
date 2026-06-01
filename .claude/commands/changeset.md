---
description: Add a Changesets changeset for the changes on the current branch
---

Add a [Changesets](https://github.com/changesets/changesets) changeset describing the
changes on the current branch, so this work ships with the right version bump and a
changelog entry.

Use the **`changeset` skill** to do this. In short:

1. `git fetch origin main` then `git diff --name-only origin/main...HEAD` to see which
   packages changed.
2. Map changed files to **publishable** packages (skip private packages and docs-only
   changes — see the skill's `references/bump-rules.md`).
3. Choose a bump per package (`feat:` → minor, `fix:` → patch, breaking → major) and
   write `.changeset/<short-name>.md` in the format from the skill's
   `references/format.md`.

Only declare the packages you actually changed — dependents bump automatically via the
internal-dependency cascade.

$ARGUMENTS
