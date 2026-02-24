---
name: commit
description: Generate a conventional commit message from staged changes
disable-model-invocation: true
---

Generate a commit message for currently staged changes.

## Steps

1. Run `git diff --staged`. If nothing is staged, run `git status`:
   - Modified tracked files → auto-stage with `git add -u` and proceed.
   - Untracked files → list them and ask which to stage. Never auto-stage untracked files.
   - Both → auto-stage tracked, ask about untracked.
   - Clean tree → inform and stop.
   Abort if staged files contain secrets (`.env`, keys, credentials, tokens).
2. Analyze the diff to understand what changed and why.
3. Suggest a commit message following the conventions in [conventions.md](../conventions.md).
4. Show the message and let me edit before committing.
5. Once confirmed, create the commit.
