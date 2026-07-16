import { cpus, freemem, totalmem } from 'node:os'
import { open, lstat, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { crashRecordV1Schema } from '../shared/crash-types'
import { redactSecrets, redactSecretText } from '../shared/secret-redaction'
import {
  diagnosticsExportResultSchema,
  type DiagnosticsExportResult
} from '../shared/diagnostics'
import { crashIndexEntryV1Schema } from './crash-store'

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024
const RUNTIME_LOG_DAYS = 3

export interface DiagnosticsAppInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion?: string
  platform: string
  arch: string
  packaged: boolean
}

export interface DiagnosticsManifestEntry {
  path: string
  source: string
  originalBytes: number
  includedBytes: number
  truncated: boolean
}

export interface DiagnosticsSkippedEntry {
  source: string
  reason: string
}

export interface DiagnosticsManifest {
  schemaVersion: 1
  exportedAt: string
  app: DiagnosticsAppInfo
  limits: { maxFileBytes: number; maxTotalBytes: number }
  included: DiagnosticsManifestEntry[]
  skipped: DiagnosticsSkippedEntry[]
}

export interface BuildDiagnosticsArchiveOptions {
  userDataPath: string
  appInfo: DiagnosticsAppInfo
  now?: () => Date
  maxFileBytes?: number
  maxTotalBytes?: number
}

export interface DiagnosticsArchive {
  data: Buffer
  manifest: DiagnosticsManifest
}

export interface ExportDiagnosticsOptions extends BuildDiagnosticsArchiveOptions {
  showSaveDialog: (options: {
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
  }) => Promise<{ canceled: boolean; filePath?: string }>
}

type CandidateCategory = 'runtime' | 'crash' | 'startup'

type ArchiveCandidate = DiagnosticsManifestEntry & {
  category: CandidateCategory
  content: Buffer
  sortTime: number
}

type NativeDumpInfo = {
  file: string
  size: number
  modifiedAt: string
}

function relativeSource(...parts: string[]): string {
  return parts.join('/')
}

function safeIsoDate(date: Date): string {
  try {
    return date.toISOString()
  } catch {
    return new Date().toISOString()
  }
}

async function readFileTail(
  path: string,
  maxBytes: number
): Promise<{ content: Buffer; originalBytes: number; truncated: boolean }> {
  const info = await lstat(path)
  if (!info.isFile()) throw new Error('Diagnostic source is not a regular file.')
  const originalBytes = Math.max(0, info.size)
  const includedBytes = Math.min(originalBytes, maxBytes)
  if (includedBytes === 0) {
    return { content: Buffer.alloc(0), originalBytes, truncated: false }
  }
  const handle = await open(path, 'r')
  try {
    const content = Buffer.alloc(includedBytes)
    const { bytesRead } = await handle.read(
      content,
      0,
      includedBytes,
      Math.max(0, originalBytes - includedBytes)
    )
    return {
      content: content.subarray(0, bytesRead),
      originalBytes,
      truncated: originalBytes > bytesRead
    }
  } finally {
    await handle.close()
  }
}

function structuredContent(value: unknown): Buffer {
  const sanitized = sanitizeStructuredDiagnosticValue(redactSecrets(value))
  return Buffer.from(`${JSON.stringify(sanitized, null, 2)}\n`, 'utf8')
}

function redactDiagnosticText(value: string): string {
  const withoutSecrets = redactSecretText(value)
  const withoutContent = withoutSecrets.replace(
    /\b(prompt|content|userText|userMessage|assistantText|assistantMessage)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;]+)/gi,
    (_match, key: string) => `${key}=<redacted>`
  )
  const trimmed = withoutContent.trim()
  // Wholly redact only a single-line value that *is* a path (covers paths
  // containing spaces, which the inline token rule below cannot). Multi-line
  // text — e.g. a whole runtime-log tail that merely starts with a path —
  // must fall through to the inline rules; a bare prefix match here used to
  // replace the entire document with '<path-redacted>'.
  if (!trimmed.includes('\n') && /^(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|\/)/i.test(trimmed)) {
    return '<path-redacted>'
  }
  const withoutFileUrls = withoutContent.replace(
    /\bfile:\/\/[^\s"',;)\]}]+/gi,
    '<path-redacted>'
  )
  return withoutFileUrls.replace(
    /(^|[\s="'(])((?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"',;)\]}]+)/gm,
    (_match, prefix: string) => `${prefix}<path-redacted>`
  )
}

const DIAGNOSTIC_CONTENT_KEY_PATTERN =
  /^(?:prompt|content|userText|userMessage|assistantText|assistantMessage)$/i

function sanitizeStructuredDiagnosticValue(value: unknown, key = ''): unknown {
  if (DIAGNOSTIC_CONTENT_KEY_PATTERN.test(key)) return '<redacted>'
  if (typeof value === 'string') {
    return key === 'route' ? redactSecretText(value) : redactDiagnosticText(value)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeStructuredDiagnosticValue(entry))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeStructuredDiagnosticValue(childValue, childKey)
    ])
  )
}

async function collectStructuredCandidate(options: {
  sourcePath: string
  source: string
  destination: string
  category: CandidateCategory
  maxFileBytes: number
  validate?: (value: unknown) => unknown | null
  skipped: DiagnosticsSkippedEntry[]
}): Promise<ArchiveCandidate | null> {
  try {
    const file = await readFileTail(options.sourcePath, options.maxFileBytes)
    if (file.truncated) {
      options.skipped.push({ source: options.source, reason: 'structured-file-too-large' })
      return null
    }
    const parsed = JSON.parse(file.content.toString('utf8')) as unknown
    const validated = options.validate ? options.validate(parsed) : parsed
    if (validated === null) {
      options.skipped.push({ source: options.source, reason: 'invalid-structure' })
      return null
    }
    const content = structuredContent(validated)
    const info = await stat(options.sourcePath)
    return {
      path: options.destination,
      source: options.source,
      originalBytes: file.originalBytes,
      includedBytes: content.length,
      truncated: false,
      category: options.category,
      content,
      sortTime: info.mtimeMs
    }
  } catch (error) {
    options.skipped.push({
      source: options.source,
      reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid-json'
    })
    return null
  }
}

function runtimeLogDate(file: string): number | null {
  const match = /^(?:kun|deepseek-gui)-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(file)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const time = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(time)) return null
  const parsed = new Date(time)
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? time
    : null
}

async function collectRuntimeLogs(options: {
  userDataPath: string
  now: Date
  maxFileBytes: number
  skipped: DiagnosticsSkippedEntry[]
}): Promise<ArchiveCandidate[]> {
  const logDirectory = join(options.userDataPath, 'logs')
  let files: string[] = []
  try {
    files = await readdir(logDirectory)
  } catch {
    return []
  }
  const cutoff = Date.UTC(
    options.now.getUTCFullYear(),
    options.now.getUTCMonth(),
    options.now.getUTCDate() - (RUNTIME_LOG_DAYS - 1)
  )
  const currentDay = Date.UTC(
    options.now.getUTCFullYear(),
    options.now.getUTCMonth(),
    options.now.getUTCDate()
  )
  const candidates: ArchiveCandidate[] = []
  for (const file of files) {
    const date = runtimeLogDate(file)
    if (date === null || date < cutoff || date > currentDay) continue
    const source = relativeSource('logs', file)
    try {
      const input = await readFileTail(join(logDirectory, file), options.maxFileBytes)
      const content = Buffer.from(redactDiagnosticText(input.content.toString('utf8')), 'utf8')
      candidates.push({
        path: relativeSource('runtime', file),
        source,
        originalBytes: input.originalBytes,
        includedBytes: content.length,
        truncated: input.truncated,
        category: 'runtime',
        content,
        sortTime: date
      })
    } catch {
      options.skipped.push({ source, reason: 'unreadable' })
    }
  }
  return candidates
}

async function collectNativeDumps(userDataPath: string): Promise<NativeDumpInfo[]> {
  const nativeDirectory = join(userDataPath, 'logs', 'crash', 'native')
  let files: string[] = []
  try {
    files = await readdir(nativeDirectory)
  } catch {
    return []
  }
  const dumps: NativeDumpInfo[] = []
  for (const file of files.sort()) {
    if (!file.toLowerCase().endsWith('.dmp')) continue
    try {
      const info = await stat(join(nativeDirectory, file))
      if (!info.isFile()) continue
      dumps.push({ file: basename(file), size: info.size, modifiedAt: safeIsoDate(info.mtime) })
    } catch {
      // Native dump metadata is optional; unreadable entries are omitted.
    }
  }
  return dumps
}

function applyTotalLimit(
  candidates: ArchiveCandidate[],
  maxTotalBytes: number,
  skipped: DiagnosticsSkippedEntry[]
): ArchiveCandidate[] {
  const selected = new Set(candidates)
  let totalBytes = candidates.reduce((total, candidate) => total + candidate.content.length, 0)
  const removalOrder = [
    ...candidates.filter((candidate) => candidate.category === 'runtime').sort((a, b) => a.sortTime - b.sortTime),
    ...candidates.filter((candidate) => candidate.category === 'crash').sort((a, b) => a.sortTime - b.sortTime),
    ...candidates.filter((candidate) => candidate.category === 'startup').sort((a, b) => a.sortTime - b.sortTime)
  ]
  for (const candidate of removalOrder) {
    if (totalBytes <= maxTotalBytes) break
    if (!selected.delete(candidate)) continue
    totalBytes -= candidate.content.length
    skipped.push({ source: candidate.source, reason: 'total-size-limit' })
  }
  return candidates.filter((candidate) => selected.has(candidate))
}

export async function buildDiagnosticsArchive(
  options: BuildDiagnosticsArchiveOptions
): Promise<DiagnosticsArchive> {
  const now = options.now?.() ?? new Date()
  const maxFileBytes = Math.max(1, Math.floor(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES))
  const maxTotalBytes = Math.max(0, Math.floor(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES))
  const skipped: DiagnosticsSkippedEntry[] = []
  const candidates: ArchiveCandidate[] = []
  const crashDirectory = join(options.userDataPath, 'logs', 'crash')

  let crashFiles: string[] = []
  try {
    crashFiles = await readdir(crashDirectory)
  } catch {
    crashFiles = []
  }
  for (const file of crashFiles.sort()) {
    if (file === 'crash-index.json') continue
    if (!/^crash-[A-Za-z0-9_-]+\.json$/.test(file)) continue
    const candidate = await collectStructuredCandidate({
      sourcePath: join(crashDirectory, file),
      source: relativeSource('logs', 'crash', file),
      destination: relativeSource('crash', file),
      category: 'crash',
      maxFileBytes,
      validate: (value) => {
        const parsed = crashRecordV1Schema.safeParse(value)
        return parsed.success ? parsed.data : null
      },
      skipped
    })
    if (candidate) candidates.push(candidate)
  }

  let recentErrors: unknown[] = []
  const indexCandidate = await collectStructuredCandidate({
    sourcePath: join(crashDirectory, 'crash-index.json'),
    source: relativeSource('logs', 'crash', 'crash-index.json'),
    destination: relativeSource('crash', 'crash-index.json'),
    category: 'crash',
    maxFileBytes,
    validate: (value) => {
      const parsed = crashIndexEntryV1Schema.array().safeParse(value)
      if (!parsed.success) return null
      recentErrors = parsed.data.slice(-20)
      return parsed.data
    },
    skipped
  })
  if (indexCandidate) candidates.push(indexCandidate)

  candidates.push(...await collectRuntimeLogs({
    userDataPath: options.userDataPath,
    now,
    maxFileBytes,
    skipped
  }))

  for (const file of ['startup-history.json', 'kun-crash-history.json']) {
    const candidate = await collectStructuredCandidate({
      sourcePath: join(options.userDataPath, 'perf', file),
      source: relativeSource('perf', file),
      destination: relativeSource('startup', file),
      category: 'startup',
      maxFileBytes,
      skipped
    })
    if (candidate) candidates.push(candidate)
  }

  const selected = applyTotalLimit(candidates, maxTotalBytes, skipped)
  const nativeDumps = await collectNativeDumps(options.userDataPath)
  const processMemory = process.memoryUsage()
  const cpuList = cpus()
  const systemInfo = {
    generatedAt: safeIsoDate(now),
    app: options.appInfo,
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1_000),
      memory: {
        rss: processMemory.rss,
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external
      }
    },
    systemMemory: { totalBytes: totalmem(), freeBytes: freemem() },
    cpu: { count: cpuList.length, model: cpuList[0]?.model ?? '' },
    nativeDumps
  }
  const manifest: DiagnosticsManifest = {
    schemaVersion: 1,
    exportedAt: safeIsoDate(now),
    app: options.appInfo,
    limits: { maxFileBytes, maxTotalBytes },
    included: selected.map(({ path, source, originalBytes, includedBytes, truncated }) => ({
      path,
      source,
      originalBytes,
      includedBytes,
      truncated
    })),
    skipped
  }

  const zip = new JSZip()
  for (const candidate of selected) zip.file(candidate.path, candidate.content)
  zip.file('system/system-info.json', structuredContent(systemInfo))
  zip.file('errors/recent-errors.json', structuredContent(recentErrors))
  zip.file('manifest.json', structuredContent(manifest))
  const data = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  return { data, manifest }
}

export async function writeDiagnosticsArchive(
  destinationPath: string,
  options: BuildDiagnosticsArchiveOptions
): Promise<DiagnosticsArchive> {
  const archive = await buildDiagnosticsArchive(options)
  await mkdir(dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.tmp`
  try {
    await writeFile(temporaryPath, archive.data)
    await rename(temporaryPath, destinationPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return archive
}

function diagnosticsFileName(date: Date): string {
  const stamp = safeIsoDate(date).replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `Claude360-Copilot-diagnostics-${stamp}.zip`
}

export async function exportDiagnostics(
  options: ExportDiagnosticsOptions
): Promise<DiagnosticsExportResult> {
  try {
    const now = options.now?.() ?? new Date()
    const result = await options.showSaveDialog({
      defaultPath: diagnosticsFileName(now),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) {
      return diagnosticsExportResultSchema.parse({ ok: false, canceled: true })
    }
    await writeDiagnosticsArchive(result.filePath, { ...options, now: () => now })
    return diagnosticsExportResultSchema.parse({ ok: true, path: result.filePath })
  } catch (error) {
    const message = redactSecretText(
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2_000) || 'Failed to export diagnostics.'
    return diagnosticsExportResultSchema.parse({ ok: false, message })
  }
}
