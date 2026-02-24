# Commit Message Conventions

Follow Conventional Commits format for all commit messages.

## Title

`<type>(<scope>): <description>`

- Imperative mood, lowercase, no period
- The entire title line (including `type(scope): `) must be under 72 characters — this is a hard limit
- Focus on **why**, not just what. For fixes, state the problem being solved (e.g. `fix(fees): prevent double-charge on retry` not `fix(fees): update retry logic`)

## Types

`feat|fix|chore|refactor|test|docs|style|perf|ci|build`

- **Source code changes:** `feat` (new capability), `fix` (bug correction), `perf` (faster/leaner), `refactor` (structure improvement, no behavior change), `style` (code formatting only, not CSS)
- **Non-source changes:** `build` (deps/build system), `ci` (CI config), `chore` (other maintenance), `docs` (documentation), `test` (tests only). `docs` is only for user-facing documentation (READMEs, API docs, guides) — config and tooling files (`.claude/`, editor configs, linter rules) are `chore`

## Scope

The package or area affected (e.g. `sui-provider`, `core`, `types`).

## Body

- Only add a body if the title alone doesn't explain the change (e.g. multiple unrelated modifications, non-obvious reasoning). Prefer title-only messages.
- When a body is needed, use a `Changes:` header followed by a bulleted list (one `- ` item per change).

## Footer

- Append `BREAKING CHANGE:` footer if applicable.
