---
name: squash
description: Squash commits on the current branch into clean, scope-grouped commits
argument-hint: optional base branch name (defaults to main/master)
disable-model-invocation: true
---

Squash commits on the current branch into clean, scope-grouped commits.

## Steps

1. Get current branch. Abort if on `main`/`master`. If dirty, ask to stash first.
2. Use provided argument as base, or detect `main`/`master`, or fall back to upstream tracking branch.
3. Abort if branch is behind base (needs rebase first).
4. Show `git log --oneline <base>..HEAD` with count and diff stat. Stop if < 2 commits. Warn if merge commits are present — recommend rebase instead.
5. Ask: squash all or last N?
6. Create backup `squash-backup/<branch>`. If it already exists, prompt to overwrite or pick a new name.
7. Analyze the full diff (`git diff <base>..HEAD`) and group changes by scope (package or area affected) and type (feat, fix, refactor, etc.). For each group, craft a commit message.
   - If all changes share a single scope and type → propose one commit.
   - Otherwise → propose one commit per scope+type pair, ordered by dependency (foundational changes first).
   - For each commit, follow the conventions in [conventions.md](../conventions.md).
   - Collect and append any Co-authored-by/Signed-off-by trailers from original commits to each new commit.
   - Present the full plan (list of commits with their messages and files) and let me customize before proceeding.
8. Squash via `git reset --soft` (merge-base for all, `HEAD~N` for partial). Then create commits in order, staging only the relevant files for each scope with `git add <files>` before committing.
9. On failure, rollback with `git reset --hard squash-backup/<branch>` and inform me.
10. Show `git log --oneline -5` to verify. List stale `squash-backup/*` branches and offer cleanup.

## Rules

- NEVER force push automatically. After squashing, ask if I want to `git push --force-with-lease`.
- After a successful push, offer to delete the backup branch.
