// Builds the markdown for the single, self-updating bundle size PR comment.
//
//   node scripts/size-report.mjs <base.json> <head.json> > size.md
//
// Optional env: BASE_SHA, HEAD_SHA, RUN_URL.
import { readFileSync } from 'node:fs'

// A change is only called out when it passes BOTH thresholds, so tiny noise stays quiet.
const NOTICE_BYTES = 512
const NOTICE_PERCENT = 1
const BAR_CELLS = 10

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
const { BASE_SHA, HEAD_SHA, RUN_URL, GITHUB_REPOSITORY } = process.env
const configUrl = GITHUB_REPOSITORY
  ? `https://github.com/${GITHUB_REPOSITORY}/blob/${HEAD_SHA || 'HEAD'}/.size-limit.json`
  : '.size-limit.json'

const kb = (bytes) => `${(bytes / 1000).toFixed(bytes < 10_000 ? 2 : 1)} kB`
const signed = (bytes) => `${bytes > 0 ? '+' : '−'}${kb(Math.abs(bytes))}`
const pct = (value) => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`
const short = (sha) => (sha ? sha.slice(0, 7) : '')

const rows = head.map((current) => {
  const [first, ...rest] = current.name.split(' · ')
  // Names without ' · ' have no group, so they go in one shared section.
  const group = rest.length ? first : 'Other'
  const label = rest.length ? rest.join(' · ') : current.name
  // A zero-size base has no meaningful delta, so treat it like a missing one.
  const before = base.get(current.name)?.size
    ? base.get(current.name)
    : undefined
  const delta = before ? current.size - before.size : null
  const percent = before ? (delta / before.size) * 100 : null
  const noticeable =
    delta !== null &&
    Math.abs(delta) >= NOTICE_BYTES &&
    Math.abs(percent) >= NOTICE_PERCENT
  const overBudget = current.passed === false
  const used = current.sizeLimit ? current.size / current.sizeLimit : null

  let icon = '⚪'
  if (overBudget) {
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
  if (row.delta === null) {
    return '🆕 new'
  }
  if (row.delta === 0) {
    return '—'
  }
  const arrow = row.delta > 0 ? '🔺' : '🔻'
  const text = `${arrow} ${signed(row.delta)} (${pct(row.percent)})`
  return row.noticeable ? `**${text}**` : text
}

const over = rows.filter((r) => r.overBudget)
const grew = rows.filter((r) => !r.overBudget && r.noticeable && r.delta > 0)
const shrank = rows.filter((r) => r.noticeable && r.delta < 0)

let verdict
if (head.length === 0) {
  verdict = '❔ **No size data.** The measurement step produced no results.'
} else if (over.length) {
  verdict = `❌ **${over.length} ${over.length === 1 ? 'check is' : 'checks are'} over budget.** Reduce the size, or raise the limit in \`.size-limit.json\` and explain why in the PR.`
} else if (grew.length) {
  verdict = `⚠️ **${grew.length} ${grew.length === 1 ? 'check grew' : 'checks grew'}** by more than ${NOTICE_PERCENT}% and ${NOTICE_BYTES} B.`
} else if (shrank.length) {
  verdict = `🎉 **Smaller bundles.** ${shrank.length} ${shrank.length === 1 ? 'check shrank' : 'checks shrank'}, none grew.`
} else {
  verdict = '✅ **No significant changes.** Every check is within budget.'
}

const sections = []
for (const group of [...new Set(rows.map((r) => r.group))]) {
  const table = rows
    .filter((r) => r.group === group)
    .map(
      (r) =>
        `| ${r.icon} | ${r.overBudget ? `**${r.label}**` : r.label} | ${r.before ? kb(r.before.size) : '—'} | ${kb(r.current.size)} | ${changeCell(r)} | ${bar(r.used)} |`
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

const baseNote = base.size
  ? ''
  : '> ℹ️ No baseline was found, so changes are not shown. Budgets are still checked.\n\n'

const footer = [
  '<details>',
  '<summary>How to read this</summary>',
  '',
  '- Sizes are **minified + brotli**, measured with [size-limit](https://github.com/ai/size-limit) the way a consumer bundles the import (tree-shaken, `@lifi/sdk` excluded from provider checks, all other dependencies included).',
  `- 🟠 / 🟢 mark a change of at least ${NOTICE_BYTES} B **and** ${NOTICE_PERCENT}%. 🔴 means the check is over its budget.`,
  `- Budgets live in [\`.size-limit.json\`](${configUrl}). The base commit is measured with the same checks as the PR.`,
  '</details>',
].join('\n')

const meta = [
  BASE_SHA && `base \`${short(BASE_SHA)}\``,
  HEAD_SHA && `head \`${short(HEAD_SHA)}\``,
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
    baseNote + sections.join('\n\n'),
    '',
    footer,
    '',
    meta && `<sub>${meta}</sub>`,
  ].join('\n')}\n`
)
