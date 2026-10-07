// Usage: node scripts/size-report.mjs <base.json> <head.json> > size.md
// Optional env: BASE_SHA, HEAD_SHA, RUN_URL, GITHUB_REPOSITORY, BASE_OUTCOME.
import { readFileSync } from 'node:fs'

// A change is only called out when it passes BOTH thresholds, so tiny noise stays quiet.
const NOTICE_BYTES = 512
const NOTICE_PERCENT = 1
const BAR_CELLS = 10
const CAUSE_MIN_BYTES = 200
const CAUSE_TOP = 5

const read = (path) => {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

const [basePath, headPath] = process.argv.slice(2)
const base = new Map(read(basePath).map((r) => [r.name, r]))
const head = read(headPath)
const { BASE_SHA, HEAD_SHA, RUN_URL, GITHUB_REPOSITORY, BASE_OUTCOME } =
  process.env
const configUrl = GITHUB_REPOSITORY
  ? `https://github.com/${GITHUB_REPOSITORY}/blob/${HEAD_SHA || 'HEAD'}/.size-limit.json`
  : '.size-limit.json'

const kb = (bytes) => `${(bytes / 1000).toFixed(bytes < 10_000 ? 2 : 1)} kB`
const signed = (bytes) => `${bytes > 0 ? '+' : '−'}${kb(Math.abs(bytes))}`
const pct = (value) => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`
const short = (sha) => (sha ? sha.slice(0, 7) : '')

const baseUsable = [...base.values()].some((r) => typeof r.size === 'number')
const rows = head.map((current) => {
  const [first, ...rest] = current.name.split(' · ')
  const group = rest.length ? first : 'Other'
  const label = rest.length ? rest.join(' · ') : current.name
  const previous = base.get(current.name)
  const before = typeof previous?.size === 'number' ? previous : undefined
  // The base had this check but could not measure it, e.g. a missing export.
  const baselineFailed =
    !baseUsable || (previous !== undefined && before === undefined)
  // size-limit omits `size` when a check found no files to measure.
  const missing = typeof current.size !== 'number'
  const delta = before && !missing ? current.size - before.size : null
  // A zero-byte base has no percentage, so only the byte threshold applies.
  const percent =
    delta === null || !before.size ? null : (delta / before.size) * 100
  const noticeable =
    delta !== null &&
    Math.abs(delta) >= NOTICE_BYTES &&
    Math.abs(percent ?? Number.POSITIVE_INFINITY) >= NOTICE_PERCENT
  const overBudget = current.passed === false
  const used =
    !missing && current.sizeLimit ? current.size / current.sizeLimit : null

  let icon = '⚪'
  if (missing) {
    icon = '❔'
  } else if (overBudget) {
    icon = '🔴'
  } else if (noticeable && delta > 0) {
    icon = '🟠'
  } else if (noticeable && delta < 0) {
    icon = '🟢'
  }

  return {
    group,
    label,
    before,
    current,
    delta,
    percent,
    noticeable,
    missing,
    baselineFailed,
    overBudget,
    used,
    icon,
  }
})

const bar = (used) => {
  if (used === null) {
    return ''
  }
  const filled = Math.min(BAR_CELLS, Math.round(used * BAR_CELLS))
  const text = '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
  return `\`${text}\` ${Math.round(used * 100)}%`
}

const changeCell = (row) => {
  if (row.missing) {
    return '⚠️ not measured'
  }
  if (row.baselineFailed) {
    return '— baseline n/a'
  }
  if (row.delta === null) {
    return '🆕 new'
  }
  if (row.delta === 0) {
    return '—'
  }
  const arrow = row.delta > 0 ? '🔺' : '🔻'
  const text = `${arrow} ${signed(row.delta)}${
    row.percent === null ? '' : ` (${pct(row.percent)})`
  }`
  return row.noticeable ? `**${text}**` : text
}

const missingRows = rows.filter((r) => r.missing)
const over = rows.filter((r) => r.overBudget)
const grew = rows.filter((r) => !r.overBudget && r.noticeable && r.delta > 0)
const shrank = rows.filter((r) => r.noticeable && r.delta < 0)

let verdict
if (head.length === 0) {
  verdict =
    '❔ **No size data.** The build or the measurement step failed. See the workflow run.'
} else if (missingRows.length || over.length) {
  const problems = []
  if (missingRows.length) {
    problems.push(
      `**${missingRows.length} ${missingRows.length === 1 ? 'check' : 'checks'} could not be measured.** Check the build, the import, and the path in \`.size-limit.json\`. The cause is in the "Measure PR" step log.`
    )
  }
  if (over.length) {
    problems.push(
      `**${over.length} ${over.length === 1 ? 'check is' : 'checks are'} over budget.** Reduce the size, or raise the limit in \`.size-limit.json\` and explain why in the PR.`
    )
  }
  verdict = `❌ ${problems.join(' ')}`
} else if (grew.length) {
  verdict = `⚠️ **${grew.length} ${grew.length === 1 ? 'check grew' : 'checks grew'}** by more than ${NOTICE_PERCENT}% and ${NOTICE_BYTES} B.`
} else if (shrank.length) {
  verdict = `🎉 **Smaller bundles.** ${shrank.length} ${shrank.length === 1 ? 'check shrank' : 'checks shrank'}, none grew.`
} else if (!baseUsable) {
  verdict =
    '✅ **Within budget.** There is no baseline, so changes are not compared.'
} else {
  verdict = '✅ **No significant changes.** Every check is within budget.'
}

const sections = []
for (const group of [...new Set(rows.map((r) => r.group))]) {
  const table = rows
    .filter((r) => r.group === group)
    .map(
      (r) =>
        `| ${r.icon} | ${r.overBudget ? `**${r.label}**` : r.label} | ${r.before ? kb(r.before.size) : '—'} | ${r.missing ? '—' : kb(r.current.size)} | ${changeCell(r)} | ${bar(r.used)} |`
    )
  sections.push(
    [
      `#### ${group}`,
      '',
      '| | Import | Base | PR | Change | Budget used |',
      '|:-:|:--|--:|--:|:--|:--|',
      ...table,
    ].join('\n')
  )
}

const baseNote = baseUsable
  ? ''
  : `> ℹ️ ${
      {
        failure: 'The base commit failed to build',
        'measure-failure': 'The base commit could not be measured',
      }[BASE_OUTCOME] ?? 'No baseline was found'
    }, so changes are not shown. Budgets are still checked.\n\n`

// Which packages explain a change, from the per-package minified bytes of both bundles.
const cause = (row) => {
  const before = row.before?.packages
  const after = row.current.packages
  if (!before || !after) {
    return null
  }
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((name) => ({
      name,
      from: before[name] ?? 0,
      to: after[name] ?? 0,
    }))
    .map((change) => ({ ...change, delta: change.to - change.from }))
    .filter((change) => Math.abs(change.delta) >= CAUSE_MIN_BYTES)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  if (!changes.length) {
    return null
  }
  const parts = changes.slice(0, CAUSE_TOP).map(({ name, from, to, delta }) => {
    if (!from) {
      return `🆕 \`${name}\` ${signed(delta)}`
    }
    if (!to) {
      return `➖ \`${name}\` ${signed(delta)}`
    }
    return `\`${name}\` ${signed(delta)}`
  })
  const rest = changes.length - CAUSE_TOP
  return `${parts.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`
}

const causes = rows
  .filter((r) => r.delta && (r.noticeable || r.overBudget))
  .map((r) => {
    const text = cause(r)
    return text && `- **${r.group} · ${r.label}** (${signed(r.delta)}): ${text}`
  })
  .filter(Boolean)

const causeSection = causes.length
  ? [
      '#### What changed',
      '',
      ...causes,
      '',
      '<sub>Per package, in minified bytes before compression. 🆕 = new in the bundle, ➖ = removed.</sub>',
    ].join('\n')
  : ''

const footer = [
  '<details>',
  '<summary>How to read this</summary>',
  '',
  "- Sizes are **minified + brotli**, measured with [size-limit](https://github.com/ai/size-limit) the way an app bundles the import: tree-shaken, with all dependencies included except the ones in the check's `ignore` list (packages the app already has, such as peers).",
  "- Code behind a dynamic `import()` is counted too, unless the check's name says otherwise.",
  `- 🟠 / 🟢 mark a change of at least ${NOTICE_BYTES} B **and** ${NOTICE_PERCENT}%. 🔴 means the check is over its budget.`,
  `- Budgets live in [\`.size-limit.json\`](${configUrl}). The base commit is measured with the same checks as the PR.`,
  '</details>',
].join('\n')

const meta = [
  HEAD_SHA &&
    BASE_SHA &&
    `\`${short(HEAD_SHA)}\` merged into \`${short(BASE_SHA)}\``,
  RUN_URL && `[workflow run](${RUN_URL})`,
]
  .filter(Boolean)
  .join(' · ')

process.stdout.write(
  `${[
    '## 📦 Bundle size',
    '',
    verdict,
    '',
    baseNote + [...sections, causeSection].filter(Boolean).join('\n\n'),
    '',
    footer,
    '',
    meta && `<sub>${meta}</sub>`,
  ].join('\n')}\n`
)
