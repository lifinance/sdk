// bump-helpers.js — pure helpers of bump.mjs: manifest and yaml edits, commit grouping, the
// PR text, and the branch guards. Same copy rule as lib.js.

import {
  cmpRaw,
  EXACT_EXCLUDE_RE,
  escapeRegExp,
  parseExcludes,
  parseVersion,
  specName,
  unquote,
} from './lib.js'

// --- bump.mjs helpers (pure, unit-tested) -------------------------------------

const EXACT_TOKEN_RE = /(?:@[\w.~-]+\/)?[\w.~-]+@\d+\.\d+\.\d+/g
const KEEP_EXCLUDES = new Set(['@bigmi/*', '@lifi/*'])
const quoteIfScoped = (s) => (s.startsWith('@') ? `'${s}'` : s)

// Edit `minimumReleaseAgeExclude` in a pnpm-workspace.yaml text. Returns { text, removed }.
//   add:     exact entries to add (deduplicated);
//   remove:  `name@version` entries to remove (never `@bigmi/*` or `@lifi/*`). An item with
//            several versions (`foo@1.0.0 || 1.1.0`) loses only the removed versions. Every
//            line of the comment block above the key that names only removed entries goes
//            too. `removed` lists what the edit really removed;
//   comment: one comment line (with `#`) to add at the end of that block (pnpm drops
//            comments between the items, so the reason lives above the key).
// The item region follows the same rule as yamlList (blank lines and comments do not end
// it). Lines that are not items stay where they are; the items are written at the place of
// the first one. Items without one exact version (globs, `a || b`) keep their order and
// come first; exact entries follow, sorted by name and version. New scoped entries are
// quoted.
export function editExcludesDetailed(
  yaml,
  { add = [], remove = [], comment = null }
) {
  if (!add.length && !remove.length && !comment) {
    return { text: yaml, removed: [] }
  }
  const lines = yaml.split('\n')
  const k = lines.findIndex((l) =>
    /^minimumReleaseAgeExclude:\s*(#.*)?$/.test(l)
  )
  if (k === -1) {
    if (!add.length) {
      return { text: yaml, removed: [] }
    }
    const body = [
      ...(comment ? [comment] : []),
      'minimumReleaseAgeExclude:',
      ...[...new Set(add)].sort().map((a) => `  - ${quoteIfScoped(a)}`),
    ]
    return {
      text: `${yaml.replace(/\n*$/, '\n')}${body.join('\n')}\n`,
      removed: [],
    }
  }
  // The region: the same rule as blockLines (blank, indented, `- x` or `#` at column 0).
  let end = k + 1
  while (
    end < lines.length &&
    (lines[end].trim() === '' ||
      /^\s/.test(lines[end]) ||
      /^- /.test(lines[end]) ||
      lines[end].startsWith('#'))
  ) {
    end++
  }
  const isItem = (l) => /^\s*-\s/.test(l)
  const region = lines.slice(k + 1, end)
  const items = region.filter(isItem).map((line) => ({
    line,
    value: unquote(line.replace(/^\s*-\s*/, '').replace(/\s+#.*$/, '')),
  }))
  const indent = items[0]?.line.match(/^(\s*)-/)[1] ?? '  '
  const removeSet = new Set(remove.filter((r) => !KEEP_EXCLUDES.has(r)))
  const removed = []
  const kept = []
  for (const item of items) {
    if (KEEP_EXCLUDES.has(item.value)) {
      kept.push(item)
      continue
    }
    const pieces = parseExcludes([item.value])
    if (!pieces.length || pieces.some((m) => m.version == null)) {
      kept.push(item)
      continue
    }
    const gone = pieces.filter((m) => removeSet.has(`${m.name}@${m.version}`))
    removed.push(...gone.map((m) => `${m.name}@${m.version}`))
    const left = pieces.filter((m) => !gone.includes(m))
    if (!left.length) {
      continue
    }
    if (!gone.length) {
      kept.push(item)
      continue
    }
    const value = `${left[0].name}@${left.map((m) => m.version).join(' || ')}`
    kept.push({ line: `${indent}- ${quoteIfScoped(value)}`, value })
  }
  for (const a of add) {
    if (!kept.some((i) => i.value === a)) {
      kept.push({ line: `${indent}- ${quoteIfScoped(a)}`, value: a })
    }
  }
  const exact = (v) => EXACT_EXCLUDE_RE.test(v)
  const sorted = [
    ...kept.filter((i) => !exact(i.value)),
    ...kept
      .filter((i) => exact(i.value))
      .sort((a, b) => {
        const [an, av] = [specName(a.value), a.value.split('@').pop()]
        const [bn, bv] = [specName(b.value), b.value.split('@').pop()]
        return an.localeCompare(bn) || cmpRaw(av, bv)
      }),
  ].map((i) => i.line)
  const firstItem = region.findIndex(isItem)
  const at = firstItem === -1 ? 0 : firstItem
  const others = region.filter((l) => !isItem(l))
  const othersBefore = region.slice(0, at).filter((l) => !isItem(l))
  const newRegion = [
    ...othersBefore,
    ...sorted,
    ...others.slice(othersBefore.length),
  ]
  // The comment block directly above the key.
  const removedSet = new Set(removed)
  let start = k
  while (start > 0 && lines[start - 1].startsWith('#')) {
    start--
  }
  const block = lines.slice(start, k).filter((l) => {
    const tokens = l.match(EXACT_TOKEN_RE) ?? []
    return !(tokens.length && tokens.every((t) => removedSet.has(t)))
  })
  if (comment) {
    block.push(comment)
  }
  return {
    text: [
      ...lines.slice(0, start),
      ...block,
      lines[k],
      ...newRegion,
      ...lines.slice(end),
    ].join('\n'),
    removed,
  }
}

// Replace one override line (`key: value`) in the `overrides:` block, keeping the quote
// style of the key and the value. Returns the new text, or null when the line is missing.
export function replaceOverride(yaml, key, value, newKey, newValue) {
  const lines = yaml.split('\n')
  const k = lines.findIndex((l) => /^overrides:\s*(#.*)?$/.test(l))
  if (k === -1) {
    return null
  }
  const q = (orig, s) => {
    const c = /^["']/.test(orig) ? orig[0] : /^[@'"&*!|>%`]/.test(s) ? "'" : ''
    return `${c}${s}${c}`
  }
  for (let i = k + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() !== '' && !/^\s/.test(l)) {
      break
    }
    const m = l.match(
      /^(\s+)("[^"]+"|'[^']+'|[^:#\s][^:]*?):\s*("[^"]*"|'[^']*'|[^#]*?)(\s*#.*)?$/
    )
    if (m && unquote(m[2]) === key && unquote(m[3]) === value) {
      lines[i] = `${m[1]}${q(m[2], newKey)}: ${q(m[3], newValue)}${m[4] ?? ''}`
      return lines.join('\n')
    }
  }
  return null
}

// The specifier that `pnpm up --latest` writes for a bump to `target`, or null when the
// specifier is not bumpable (peer ranges are never passed here; `>=`/`<`, protocols,
// `||`, x-ranges and tags stay as they are). Keeps the `^`, `~` or exact prefix.
export function bumpSpec(spec, target) {
  const s = String(spec).trim()
  if (/^(workspace:|catalog:|link:|file:|npm:|git|https?:)/.test(s)) {
    return null
  }
  const m = /^([\^~]?)v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.exec(s)
  return m ? `${m[1]}${target}` : null
}

// Set `name` to `newSpec` inside the top-level `field` object of a package.json text,
// keeping the formatting. Only a key at depth 1 counts: a nested `"dependencies"` (for
// example in `pnpm.packageExtensions`) is never edited, and a name in `peerDependencies`
// stays. Returns the new text, or null when the entry is missing.
export function setDependencySpec(text, field, name, newSpec) {
  const range = topLevelObject(text, field)
  if (!range) {
    return null
  }
  const [from, close] = range
  const body = text.slice(from, close)
  const re = new RegExp(`("${escapeRegExp(name)}"\\s*:\\s*")([^"]*)(")`)
  if (!re.test(body)) {
    return null
  }
  return (
    text.slice(0, from) +
    body.replace(re, (_m, a, _v, c) => `${a}${newSpec}${c}`) +
    text.slice(close)
  )
}

// [start, end) of the body of the object value of the top-level key `key` in a JSON text,
// or null. Walks the text with string and depth tracking.
function topLevelObject(text, key) {
  let depth = 0
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') {
        j += text[j] === '\\' ? 2 : 1
      }
      const str = text.slice(i + 1, j)
      i = j + 1
      if (depth === 1 && str === key) {
        const m = /^\s*:\s*\{/.exec(text.slice(i))
        if (m) {
          const from = i + m[0].length
          // Find the matching `}` (string-aware).
          let d = 1
          let k = from
          while (k < text.length && d > 0) {
            if (text[k] === '"') {
              k++
              while (k < text.length && text[k] !== '"') {
                k += text[k] === '\\' ? 2 : 1
              }
            } else if (text[k] === '{') {
              d++
            } else if (text[k] === '}') {
              d--
            }
            k++
          }
          return d === 0 ? [from, k - 1] : null
        }
      }
      continue
    }
    if (c === '{' || c === '[') {
      depth++
    } else if (c === '}' || c === ']') {
      depth--
    }
    i++
  }
  return null
}

// `packageManager` value as corepack writes it: pnpm@X+sha512.<hex of the npm integrity>.
export function packageManagerValue(version, integrity) {
  const m = /^sha512-(.+)$/.exec(String(integrity ?? ''))
  if (!m) {
    return null
  }
  return `pnpm@${version}+sha512.${Buffer.from(m[1], 'base64').toString('hex')}`
}

export function setPackageManager(text, value) {
  return text.replace(
    /("packageManager"\s*:\s*")[^"]*(")/,
    (_m, a, b) => `${a}${value}${b}`
  )
}

// One changeset for the bump: a patch for each package, one line per dependency.
// `updates` is [{ pkg, dep, version }].
export function changesetText(updates) {
  const pkgs = [...new Set(updates.map((u) => u.pkg))].sort()
  const lines = [
    ...new Set(updates.map((u) => `Update \`${u.dep}\` to ${u.version}.`)),
  ].sort()
  return `---\n${pkgs.map((p) => `"${p}": patch`).join('\n')}\n---\n\n${lines.join('\n')}\n`
}

// `name a→b` (the plan's changeset lines) -> { dep, from, version }.
export function parseChangesetLine(s) {
  const m = /^(.+) (\S+)→(\S+)$/.exec(String(s))
  return m ? { dep: m[1], from: m[2], version: m[3] } : null
}

// Group the changed files into the commits, in order. `files` are repo-relative paths.
// The lockfile commit is always last. Files outside the known groups are `unexpected`
// (never committed).
export function groupCommits(
  files,
  { excludeAddFiles = [], packageManagerFiles = [], pnpmTarget = null } = {}
) {
  const lock = (f) => /(^|\/)pnpm-lock\.yaml$/.test(f)
  const ci = (f) => f.startsWith('.github/')
  const bump = (f) =>
    /(^|\/)(package\.json|pnpm-workspace\.yaml)$/.test(f) ||
    /^\.changeset\/[^/]+\.md$/.test(f)
  const commits = []
  if (excludeAddFiles.length) {
    commits.push({
      id: 'excludes',
      message: 'chore: allow fresh releases past the release-age gate',
      files: [...excludeAddFiles].sort(),
    })
  }
  const bumpFiles = files.filter(bump)
  if (bumpFiles.length) {
    commits.push({
      id: 'bump',
      message: 'chore: bump packages',
      files: bumpFiles.sort(),
    })
  }
  const ciFiles = files.filter(ci)
  if (ciFiles.length) {
    commits.push({
      id: 'ci',
      message: 'ci: bump GitHub Actions and CI tools',
      files: ciFiles.sort(),
    })
  }
  const lockFiles = [
    ...new Set([...files.filter(lock), ...packageManagerFiles]),
  ]
  if (lockFiles.length) {
    commits.push({
      id: 'lockfile',
      message: pnpmTarget
        ? `chore: bump pnpm to ${pnpmTarget} and regenerate the lockfile`
        : 'chore: regenerate the lockfile',
      files: lockFiles.sort(),
    })
  }
  const known = new Set(commits.flatMap((c) => c.files))
  return { commits, unexpected: files.filter((f) => !known.has(f)) }
}

// Wrap commit body lines at `width` characters (git log stays readable).
export function wrapLines(text, width = 100) {
  const out = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (line && `${line} ${word}`.length > width) {
        out.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

// Exit codes of bump.mjs.
export const EXIT = { ok: 0, cannotRun: 2, lockfileStop: 3, checkFailed: 4 }

// The PR text (F4): one generated block between markers. Each run rewrites the block; the
// text outside the markers stays. The block is stateless: `state` comes from the branch
// against origin/main (bump.mjs prState), `r` is the result of this run.
//   state: { packages: [{ name, where, from, to, bump }], excludes: [entry],
//            overrides: [{ key, from, to }], toolchain: [line] }
//   cap:   the maximum number of rows per list (GitHub refuses a body over 65,536 chars).
export const PR_START = '<!-- bump-packages:start -->'
export const PR_END = '<!-- bump-packages:end -->'

export function prBlock(state, r, cap = 150) {
  const code = (s) => `\`${s}\``
  const capped = (rows) =>
    rows.length > cap
      ? [...rows.slice(0, cap), '', `… and ${rows.length - cap} more.`]
      : rows
  const out = [PR_START, '']
  const section = (title, rows) => {
    if (rows.length) {
      out.push(`### ${title}`, '', ...capped(rows), '')
    }
  }
  if (state.packages.length) {
    out.push(
      '### Packages',
      '',
      '| Package | Where | From | To | Bump |',
      '|---|---|---|---|---|',
      ...capped(
        state.packages.map(
          (p) =>
            `| ${code(p.name)} | ${p.where} | ${p.from ?? '(new)'} | ${p.to ?? '(removed)'} | ${p.bump ?? ''} |`
        )
      ),
      ''
    )
  }
  section(
    'Allowed past the release-age gate',
    state.excludes.map((e) => `- ${code(e)}`)
  )
  section(
    'Aged exclude entries removed',
    (state.removedExcludes ?? []).map((e) => `- ${code(e)}`)
  )
  section(
    'Overrides',
    state.overrides.map(
      (o) =>
        `- ${code(o.key)}: ${o.from == null ? '(new)' : code(o.from)} → ${o.to == null ? '(removed)' : code(o.to)}`
    )
  )
  section(
    'Toolchain',
    state.toolchain.map((t) => `- ${t}`)
  )
  out.push('### This run', '')
  for (const [title, items] of [
    ['Needs the user', r.needsUser],
    ['Not applied by the script', r.notApplied],
    ['Waiting or held', r.waiting],
  ]) {
    if (items?.length) {
      out.push(
        `${title}:`,
        '',
        ...capped(
          items.map(
            (i) =>
              `- ${code(i.name)}${i.project && i.project !== '.' ? ` (${i.project})` : ''}: ${capText(i.text)}${i.flag ? ` Apply: ${code(i.flag)}` : ''}`
          )
        ),
        ''
      )
    }
  }
  if (r.lockfile) {
    out.push(
      `- Lockfile: major jumps: ${r.lockfile.majors.length ? r.lockfile.majors.map(code).join(', ') : 'none'}; single-copy packages: ${r.lockfile.singleCopy.length ? r.lockfile.singleCopy.map(code).join(', ') : 'none'}.`
    )
  }
  const n = (a) =>
    a ? Object.values(a).reduce((x, y) => x + (Number(y) || 0), 0) : '?'
  out.push(
    `- \`pnpm audit\`: ${n(r.audit?.before)} advisories before, ${n(r.audit?.after)} after.`
  )
  // A failure counts as "fails on main too" only when the baseline proved it (H2).
  const checks = (r.checks ?? []).map(
    (c) =>
      `${code(c.name)} ${c.ok ? 'pass' : c.accepted ? 'FAIL (fails on main too; accepted with --skip-check)' : 'FAIL'} (${c.seconds} s)`
  )
  out.push(
    `- Checks: ${checks.join(', ') || 'none in this run'}.`,
    '',
    'Commits skip the git hooks; the same checks ran once before the commit.',
    '',
    PR_END
  )
  return mdSafe(out.join('\n'))
}

// The old body with the block replaced; a body without markers gets the block once.
// M4: every old block and every stray marker goes; then one block is appended. The text
// of people outside the markers stays.
export function replacePrBlock(body, block) {
  const pair = new RegExp(
    `${escapeRegExp(PR_START)}[\\s\\S]*?${escapeRegExp(PR_END)}`,
    'g'
  )
  const rest = String(body ?? '')
    .replace(pair, '')
    .split(PR_START)
    .join('')
    .split(PR_END)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return rest ? `${rest}\n\n${block}\n` : `${block}\n`
}

// M4: a block that does not fit in `room` characters is cut at a line end, with a note.
export function fitPrBlock(block, room) {
  if (block.length <= room) {
    return block
  }
  const note = `\n\nThe full lists are in the run output.\n\n${PR_END}`
  const head = block.slice(0, Math.max(0, room - note.length))
  return `${head.slice(0, head.lastIndexOf('\n'))}${note}`
}

// The body of a new PR (A14). With a template that has "Which Linear task", the block
// goes into its shape; the first two checklist boxes are ticked.
export function newPrBody(block, template) {
  if (!/Which Linear task/.test(template ?? '')) {
    return `${block}\n`
  }
  const lines = template.split('\n')
  const start = lines.findIndex((l) =>
    /^##\s+Checklist before requesting a review/.test(l)
  )
  const checklist = []
  if (start !== -1) {
    let ticked = 0
    for (const l of lines.slice(start)) {
      if (checklist.length && /^##\s/.test(l)) {
        break
      }
      checklist.push(
        /^\s*- \[ \]/.test(l) && ticked++ < 2 ? l.replace('- [ ]', '- [x]') : l
      )
    }
  }
  return `${[
    '## Which Linear task is linked to this PR?',
    '',
    'None. This PR is routine dependency maintenance.',
    '',
    '## Why was it implemented this way?',
    '',
    block,
    '',
    '## Visual showcase (Screenshots or Videos)',
    '',
    'Not applicable. This is a dependency-only change.',
    ...(checklist.length ? ['', ...checklist] : []),
  ]
    .join('\n')
    .trimEnd()}\n`
}

// --- bump.mjs guards (pure, unit-tested) ---------------------------------------------

// The branch names that bump.mjs makes. An open PR is reused only on such a branch.
const BUMP_BRANCH_RE = /^chore\/bump-deps-\d{8}(-\d+)?$/

// The open bump PR to reuse: same repository (never a fork), the exact title, and a
// branch that bump.mjs made. `prs` comes from `gh pr list --json
// number,headRefName,title,isCrossRepository,headRepositoryOwner`. Returns
// { pr, all, rejected }: `all` holds every qualifying PR (more than one is an error).
export function pickBumpPr(prs, owner) {
  const rejected = []
  const ok = []
  for (const p of prs ?? []) {
    if (p.title !== 'chore: bump packages') {
      continue
    }
    const why = p.isCrossRepository
      ? 'from a fork'
      : owner &&
          p.headRepositoryOwner?.login &&
          p.headRepositoryOwner.login !== owner
        ? `head owner ${p.headRepositoryOwner.login}`
        : !BUMP_BRANCH_RE.test(p.headRefName ?? '')
          ? `branch ${p.headRefName} is not chore/bump-deps-<yyyymmdd>`
          : null
    ;(why ? rejected : ok).push(why ? { number: p.number, why } : p)
  }
  return { pr: ok[0] ?? null, all: ok, rejected }
}

// Why a worktree and branch must not be used for commits or a push, or null when they are
// safe. Never the main checkout, never the default branch, only a bump branch.
export function branchGuard({ branch, defaultBranch, worktree, mainCheckout }) {
  if (!branch || branch === 'main' || branch === defaultBranch) {
    return `branch ${branch ?? '(none)'} is the default branch`
  }
  if (!BUMP_BRANCH_RE.test(branch)) {
    return `branch ${branch} is not a bump branch (chore/bump-deps-<yyyymmdd>)`
  }
  if (worktree && mainCheckout && worktree === mainCheckout) {
    return `the worktree ${worktree} is the main checkout`
  }
  return null
}

// The exclude entries of the branch that origin/main does not have. The branch is local
// (the script only continues a local worktree), so each exact entry is an earlier entry
// (it gets the recheck); any other entry (a bare name, a range, a glob) is a STOP.
// Returns { exact, other }.
export function branchExcludes(branchEntries, mainEntries) {
  const onMain = new Set(mainEntries)
  const added = [...new Set(branchEntries.filter((e) => !onMain.has(e)))]
  return {
    exact: added.filter((e) => EXACT_EXCLUDE_RE.test(e)),
    other: added.filter((e) => !EXACT_EXCLUDE_RE.test(e)),
  }
}

// Put every `@scope/name` and bare `@name` (with an optional `@version`) outside code spans
// into backticks, so that GitHub does not read it as a mention. Text inside backticks stays
// as it is. An `@` after a word character (an e-mail address) is not a mention.
export function mdSafe(text) {
  return String(text)
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(
            /(^|[^\w`])(@[\w.-]+(?:\/[\w.-]+)?(?:@[\w.^~<>=-]+)?)/g,
            (_m, pre, name) => `${pre}\`${name}\``
          )
    )
    .join('')
}

// Text from the registry, an advisory or a branch (a comment, a flag, a reason): no
// backticks, so that it cannot close a code span; mdSafe then wraps its mentions.
// M4: also `<` and `>`, so that `<!--` or a marker in untrusted text cannot hide or break
// the generated PR block.
export const plain = (s) =>
  String(s ?? '')
    .replace(/`/g, "'")
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// M4: one list item of the PR text, at most 300 characters.
const capText = (s) => (s.length > 300 ? `${s.slice(0, 299)}…` : s)

// The summary text of one check (H1, H2).
export function checkText(c) {
  if (c.notRun) {
    return `${c.name} not run (${c.notRun})`
  }
  if (c.ok) {
    return `${c.name} ok (${c.seconds}s)`
  }
  const why = c.accepted
    ? 'fails on main too; accepted with --skip-check'
    : c.verdict === 'regression'
      ? 'regression'
      : c.verdict === 'fails-on-main'
        ? `also fails on main; compare ${c.log} with ${c.baselineLog}`
        : `baseline unknown: ${c.baselineWhy ?? 'not run'}`
  return `${c.name} FAIL (${why}) (${c.seconds}s)`
}

// "packages/widget and 5 more projects" (M7).
export const whereText = (where) =>
  where?.length
    ? ` (${where[0] === '.' ? 'root' : where[0]}${where.length > 1 ? ` and ${where.length - 1} more project${where.length > 2 ? 's' : ''}` : ''})`
    : ''

// Every applied item, one line each (G3, M6).
export function appliedLines(a) {
  // `where` is relative to the project: "." of examples/node is examples/node.
  const at = (b) =>
    b.project && b.project !== '.'
      ? (b.where ?? []).map((w) =>
          w === '.' ? b.project : `${b.project}/${w}`
        )
      : b.where
  return [
    ...[...a.bumps, ...a.majors].map(
      (b) =>
        `${b.name} ${b.from} → ${b.to}${whereText(at(b))}${b.fastTrack ? ' fast-track' : ''}${b.major ? ' major' : ''}`
    ),
    ...a.overrides.map(
      (o) =>
        `override ${o.key}: ${o.value} → ${o.newKey === o.key ? '' : `${o.newKey}: `}${o.newValue}${o.project && o.project !== '.' ? ` (${o.project})` : ''}`
    ),
    // One line for many entries: 19 removed entries of two families are noise.
    ...(a.removedExcludes.length > 3
      ? [
          `removed ${a.removedExcludes.length} aged exclude entries (${a.removedExcludes.slice(0, 2).join(', ')}, …)`,
        ]
      : a.removedExcludes.map((e) => `removed the aged exclude entry ${e}`)),
    ...a.approved.map((e) => `approved exclude entry ${e}`),
    ...a.actions.map((x) => `action ${x.repo} ${x.from} → ${x.to}`),
    ...a.tools.map((t) => `CI tool ${t.pkg} ${t.from} → ${t.to}`),
    ...(a.pnpm ? [`pnpm ${a.pnpm.from} → ${a.pnpm.to}`] : []),
  ]
}

// "4" for 4.1.5, "0.5" for 0.5.2: the line a major moves to.
export const majorLine = (v) => {
  const x = parseVersion(v)
  return x.major > 0 ? `${x.major}` : `0.${x.minor}`
}

// M3: the project folders that `--majors` changes for one plan entry. A `heldMajors`
// entry with `projects` (package names) keeps those projects; `nameOf(folder)` gives the
// name. Every project held, or no `projects`: all folders, and the entry is stale.
// Returns { where, kept, stale }.
export function majorTargets(where, held, nameOf) {
  if (!held) {
    return { where, kept: [], stale: false }
  }
  const free = held.projects
    ? where.filter((w) => !held.projects.includes(nameOf(w)))
    : []
  return free.length
    ? {
        where: free,
        kept: where.filter((w) => !free.includes(w)),
        stale: false,
      }
    : { where, kept: [], stale: true }
}

// M5: lockstep siblings. A safe bump of A to V waits when a sibling B (same npm scope, or
// the same family of the family table) has the same current version as A, has V as a
// release that is still younger than the gate, and does not move to V in this run.
// Every bump of that group to V waits too.
//   bumps:  [{ name, from, to }] (the bumps of one project)
//   others: [{ name, current, freshVersions: [{ version, eligibleInHours }] }]
//   keyOf:  name -> group key, or null
// Returns { keep: bumps that go ahead, waits: [{ key, names, blocker, version, inHours }] }.
export function lockstepWaits(bumps, others, keyOf) {
  const moving = new Set(bumps.map((b) => `${b.name}@${b.to}`))
  const blocked = new Map() // `${key} ${version}` -> { key, version, blocker, inHours }
  for (const a of bumps) {
    const key = keyOf(a.name)
    if (!key) {
      continue
    }
    for (const b of others) {
      if (b.name === a.name || keyOf(b.name) !== key || b.current !== a.from) {
        continue
      }
      const young = (b.freshVersions ?? []).find((f) => f.version === a.to)
      if (young && !moving.has(`${b.name}@${a.to}`)) {
        blocked.set(`${key} ${a.to}`, {
          key,
          version: a.to,
          blocker: b.name,
          inHours: young.eligibleInHours,
        })
      }
    }
  }
  const waits = [...blocked.values()].map((w) => ({
    ...w,
    names: bumps
      .filter((b) => keyOf(b.name) === w.key && b.to === w.version)
      .map((b) => b.name),
  }))
  const waiting = new Set(waits.flatMap((w) => w.names))
  return { keep: bumps.filter((b) => !waiting.has(b.name)), waits }
}

// The group key of a package for lockstepWaits: its family (the family table puts `next`
// and `@next/*` together), else its npm scope. A scope reads `@scope/*`.
export function lockstepKey(name, familyKeyOf) {
  const key =
    familyKeyOf(name) ?? (name.startsWith('@') ? name.split('/')[0] : null)
  return key?.startsWith('@') && !key.includes('/') ? `${key}/*` : key
}

// A reason list of one version: drop the version from each reason, so that the line does
// not name it twice ("viem@2.57.19: younger than 6 h: viem@2.57.19 (3.9 h)").
export function ownReasons(list, versions) {
  if (versions.length !== 1) {
    return list
  }
  const v = versions[0]
  return list.map((s) =>
    s.startsWith(`${v}:`) || s.startsWith(`${v} `) || s === v
      ? s.slice(v.length).replace(/^:?\s*/, '')
      : s
  )
}

// The same item in more than one project (viem in the root and in examples/node): one
// line that names every project.
export function mergeItems(items) {
  const byKey = new Map()
  for (const i of items) {
    const key = [i.kind, i.name, i.text, i.flag].join('\0')
    const had = byKey.get(key)
    if (had) {
      had.projects.push(i.project)
    } else {
      byKey.set(key, { ...i, projects: [i.project] })
    }
  }
  return [...byKey.values()].map(({ projects, ...i }) => ({
    ...i,
    project:
      projects.length > 1
        ? projects.map((p) => (p === '.' ? 'root' : p)).join(', ')
        : projects[0],
  }))
}

// The terminal summary: plain() writes `<` and `>` as entities for the PR text only.
export const terminalText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
