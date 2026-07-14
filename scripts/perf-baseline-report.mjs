#!/usr/bin/env node
/**
 * 启动性能基线报告（07-14-perf-baseline AC6/R19）。
 *
 * 读取 GUI 写入的 userData/perf/startup-history.json（appendStartupHistory
 * 产物，最近 20 条），输出每次启动的关键阶段表；--compare K 输出「前 K 次
 * vs 后 K 次」均值差，用于优化前后对比。纯 Node，无第三方依赖。
 *
 * 用法：
 *   node scripts/perf-baseline-report.mjs <path/to/startup-history.json> [--last N] [--compare K]
 *
 * 示例：
 *   node scripts/perf-baseline-report.mjs "~/.config/Claude360 Copilot/perf/startup-history.json" --last 5
 *   node scripts/perf-baseline-report.mjs history.json --compare 3
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const KEY_PHASES = [
  ['main:app-ready', 'app-ready'],
  ['main:window-ready-to-show', 'win-ready'],
  ['renderer:first-frame', 'first-frame'],
  ['renderer:interactive', 'interactive'],
  ['kun:health-ok', 'kun-health']
]

function usage(message) {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    'usage: node scripts/perf-baseline-report.mjs <path/to/startup-history.json> [--last N] [--compare K]'
  )
  process.exit(1)
}

function parseArgs(argv) {
  const args = { file: '', last: 0, compare: 0 }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '--last' || arg === '--compare') {
      const raw = rest.shift()
      const value = Number(raw)
      if (!Number.isInteger(value) || value <= 0) usage(`${arg} expects a positive integer, got "${raw}"`)
      if (arg === '--last') args.last = value
      else args.compare = value
    } else if (arg === '--help' || arg === '-h') {
      usage()
    } else if (!args.file) {
      args.file = arg
    } else {
      usage(`unexpected argument "${arg}"`)
    }
  }
  if (!args.file) usage('missing history file path')
  return args
}

function expandHome(filePath) {
  return filePath.startsWith('~/') || filePath === '~'
    ? filePath.replace('~', homedir())
    : filePath
}

function loadHistory(filePath) {
  let raw
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    usage(`cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    usage(`${filePath} is not valid JSON`)
  }
  if (!Array.isArray(parsed)) usage(`${filePath} does not contain a JSON array`)
  return parsed.filter((entry) => typeof entry === 'object' && entry !== null)
}

function formatMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '-'
}

function pad(value, width) {
  return String(value).padStart(width)
}

function printTable(records) {
  const header = [
    'at'.padEnd(20),
    'ver'.padEnd(8),
    'plat'.padEnd(11),
    ...KEY_PHASES.map(([, label]) => pad(label, 11)),
    '  flags'
  ].join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const record of records) {
    const phases = record.phases ?? {}
    const at = String(record.at ?? '').slice(0, 19).replace('T', ' ')
    const flags = []
    if (record.partial === true) flags.push(`partial(missing:${(record.missing ?? []).length})`)
    if (record.packaged === false) flags.push('dev')
    console.log(
      [
        at.padEnd(20),
        String(record.appVersion ?? '-').padEnd(8),
        `${record.platform ?? '?'}/${record.arch ?? '?'}`.padEnd(11),
        ...KEY_PHASES.map(([phase]) => pad(formatMs(phases[phase]), 11)),
        `  ${flags.join(',')}`
      ].join(' ')
    )
    if (record.partial === true && Array.isArray(record.missing) && record.missing.length > 0) {
      console.log(`${' '.repeat(22)}missing: ${record.missing.join(', ')}`)
    }
  }
}

function meanOf(records, phase) {
  const values = records
    .map((record) => record.phases?.[phase])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function printComparison(records, k) {
  if (records.length < k * 2) {
    console.log(`\n--compare ${k}: not enough records (${records.length} < ${k * 2}); skipping comparison.`)
    return
  }
  const earlier = records.slice(0, k)
  const later = records.slice(-k)
  console.log(`\nComparison: first ${k} runs vs last ${k} runs (mean, ms)`)
  const header = ['phase'.padEnd(14), pad('first', 10), pad('last', 10), pad('delta', 10), '  trend'].join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const [phase, label] of KEY_PHASES) {
    const before = meanOf(earlier, phase)
    const after = meanOf(later, phase)
    if (before === null || after === null) {
      console.log([label.padEnd(14), pad(formatMs(before), 10), pad(formatMs(after), 10), pad('-', 10), ''].join(' '))
      continue
    }
    const delta = after - before
    const sign = delta > 0 ? '+' : ''
    const trend = delta < 0 ? 'improved' : delta > 0 ? 'regressed' : 'unchanged'
    console.log(
      [
        label.padEnd(14),
        pad(Math.round(before), 10),
        pad(Math.round(after), 10),
        pad(`${sign}${Math.round(delta)}`, 10),
        `  ${trend}`
      ].join(' ')
    )
  }
}

const args = parseArgs(process.argv.slice(2))
const history = loadHistory(expandHome(args.file))
if (history.length === 0) {
  console.log('history file contains no records yet.')
  process.exit(0)
}

const shown = args.last > 0 ? history.slice(-args.last) : history
console.log(`Startup baseline report — ${shown.length}/${history.length} record(s)\n`)
printTable(shown)
if (args.compare > 0) printComparison(history, args.compare)
