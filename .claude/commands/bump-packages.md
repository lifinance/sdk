---
description: Bump npm dependencies, GitHub Actions and pnpm to latest, then open or update the "chore: bump packages" PR
---

Run the dependency bump with the **`bump-packages` skill**
(`.claude/skills/bump-packages/SKILL.md`). Its script does the whole bump:

1. Run `scripts/bump.mjs` for the repo. It works in a worktree from the latest `origin/main`,
   or on the open bump PR. It never touches the main checkout.
2. It applies the safe bumps and the clean fast-tracks, runs the checks once, commits, and
   opens or updates the PR.
3. Show me only what needs me: majors, fast-tracks without provenance, blocked items, and
   failures.

If I name more than one repo (sdk, widget, jumper-widget), run one script for each repo in
parallel, as background commands. Then give me one merged report.

$ARGUMENTS
