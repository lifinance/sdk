# Changeset file format

A changeset is a markdown file in `.changeset/` with a YAML frontmatter block mapping
package names to bump types, followed by a summary that becomes the changelog entry.

## Shape

```markdown
---
"@scope/package-a": minor
"@scope/package-b": patch
---

A human-readable summary of the change. This text is copied verbatim into each listed
package's CHANGELOG.md and its GitHub Release, so write it for someone reading release
notes — what changed and why it matters, not "fix bug".
```

- **Bump values:** `major`, `minor`, or `patch`.
- **Filename:** any unique name ending in `.md`. `pnpm changeset` generates a random one
  (e.g. `fenced-stories-add.md`); a descriptive kebab-case name like
  `fix-solana-balance-race.md` is also fine.
- **Multiple packages:** list each on its own frontmatter line. Use **separate** changeset
  files when distinct changes deserve distinct changelog entries.
- **Summary:** the first paragraph is the changelog line. Markdown is allowed; keep it
  tight. Reference a PR/issue if useful — the changelog generator
  (`@svitejs/changesets-changelog-github-compact`) adds the PR/author links automatically.

## Worked examples

**A fix in one package:**
```markdown
---
"@scope/core": patch
---

Fix a race where rapid reconnects could drop the active session.
```

**A feature touching two packages:**
```markdown
---
"@scope/client": minor
"@scope/react": minor
---

Add `useFoo()` and the underlying `getFoo()` action for querying foo state.
```

**A breaking change:**
```markdown
---
"@scope/core": major
---

Rename `connect()` to `connectWallet()` and drop the deprecated `autoConnect` option.
Migration: replace `connect(opts)` with `connectWallet(opts)`.
```

## Lifecycle (why `.changeset/` looks empty on main)

`changeset version` (run by the bot's "chore: version packages" PR) **consumes and
deletes** every `*.md` changeset, rolling them into version bumps and per-package
`CHANGELOG.md`s. So between releases, `.changeset/` holds only `config.json`, `README.md`,
and (if the repo is in pre-mode) `pre.json` — no leftover changeset files. An empty
`.changeset/` is the normal resting state, not a sign that something was lost.
