---
description: Bump npm dependencies, GitHub Actions and pnpm to latest, then open a "chore: bump packages" PR
---

Run the dependency bump with the **`bump-packages` skill**
(`.claude/skills/bump-packages/SKILL.md`). Follow it step by step:

1. Make a fresh worktree from the latest `origin/main`. Do not touch the main checkout.
2. Analyze the npm dependencies, the GitHub Actions, pnpm and Node.
3. Show one upgrade table and wait for my approval before you change anything.
4. After my approval, commit, validate, and open the PR.

If I name more than one repo (sdk, widget, jumper-widget), use one subagent for each repo.
Then give me one merged table.

$ARGUMENTS
