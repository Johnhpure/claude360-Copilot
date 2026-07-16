import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import type { CrashRecordV1 } from '../shared/crash-types'
import { buildDiagnosticsArchive, exportDiagnostics } from './diagnostics-export'

const testDirectories: string[] = []

function makeUserDataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude360-diagnostics-'))
  testDirectories.push(directory)
  return directory
}

function crashRecord(): CrashRecordV1 {
  return {
    schemaVersion: 1,
    id: 'record-1',
    kind: 'renderer-error',
    severity: 'error',
    occurredAt: '2026-07-15T08:00:00.000Z',
    process: { pid: 123, type: 'browser', uptimeMs: 1_000 },
    versions: { app: '0.1.0', electron: '34.2.0', node: '22.14.0' },
    system: { platform: 'linux', arch: 'x64', packaged: false },
    memory: { rss: 1, heapUsed: 2, heapTotal: 3, external: 4 },
    error: { name: 'Error', message: 'renderer failed' },
    context: { startupPhases: {}, runtime: null, renderer: null, recentIpc: [] }
  }
}

function exporterOptions(userDataPath: string) {
  return {
    userDataPath,
    appInfo: {
      appVersion: '0.1.0',
      electronVersion: '34.2.0',
      nodeVersion: '22.14.0',
      chromeVersion: '132.0.0.0',
      platform: 'linux',
      arch: 'x64',
      packaged: false
    },
    now: () => new Date('2026-07-15T12:00:00.000Z')
  }
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  expect(entry, `missing zip entry ${path}`).not.toBeNull()
  return entry?.async('string') ?? ''
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('buildDiagnosticsArchive', () => {
  it('exports only the diagnostic whitelist, redacts text, and lists native dumps', async () => {
    const userDataPath = makeUserDataDirectory()
    const crashDirectory = join(userDataPath, 'logs', 'crash')
    const runtimeDirectory = join(userDataPath, 'logs')
    const perfDirectory = join(userDataPath, 'perf')
    const recordFile = 'crash-20260715080000000-123-record-1.json'
    await mkdir(join(crashDirectory, 'native'), { recursive: true })
    await mkdir(perfDirectory, { recursive: true })
    await writeFile(join(crashDirectory, recordFile), JSON.stringify(crashRecord()), 'utf8')
    await writeFile(join(crashDirectory, 'crash-index.json'), JSON.stringify([{
      schemaVersion: 1,
      id: 'record-1',
      kind: 'renderer-error',
      severity: 'error',
      occurredAt: '2026-07-15T08:00:00.000Z',
      file: recordFile,
      message: 'renderer failed'
    }]), 'utf8')
    await writeFile(
      join(runtimeDirectory, 'kun-2026-07-15.log'),
      '[ERROR] Authorization: Bearer runtime-secret workspaceRoot=/home/alice/private-project prompt=private-request\n',
      'utf8'
    )
    await writeFile(join(perfDirectory, 'startup-history.json'), JSON.stringify([{ at: 1 }]), 'utf8')
    await writeFile(join(perfDirectory, 'kun-crash-history.json'), JSON.stringify([{ at: 2 }]), 'utf8')
    await writeFile(join(crashDirectory, 'native', 'memory.dmp'), 'private-memory', 'utf8')
    await writeFile(join(userDataPath, 'secure-store.json'), 'Bearer secure-secret', 'utf8')
    await writeFile(join(userDataPath, 'kun-settings.json'), 'token=settings-secret', 'utf8')

    const archive = await buildDiagnosticsArchive(exporterOptions(userDataPath))
    const zip = await JSZip.loadAsync(archive.data)
    const files = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name)
    const combinedText = await Promise.all(files.map((path) => zipText(zip, path)))

    expect(files).toEqual(expect.arrayContaining([
      'manifest.json',
      `crash/${recordFile}`,
      'crash/crash-index.json',
      'runtime/kun-2026-07-15.log',
      'startup/startup-history.json',
      'startup/kun-crash-history.json',
      'system/system-info.json',
      'errors/recent-errors.json'
    ]))
    expect(files.some((path) => path.endsWith('.dmp'))).toBe(false)
    expect(files).not.toContain('secure-store.json')
    expect(files).not.toContain('kun-settings.json')
    expect(combinedText.join('\n')).not.toContain('runtime-secret')
    expect(combinedText.join('\n')).not.toContain('secure-secret')
    expect(combinedText.join('\n')).not.toContain('/home/alice/private-project')
    expect(combinedText.join('\n')).not.toContain('private-request')
    expect(archive.manifest.skipped.some(
      (entry) => entry.source === 'logs/crash/crash-index.json'
    )).toBe(false)

    const systemInfo = JSON.parse(await zipText(zip, 'system/system-info.json')) as {
      nativeDumps: Array<{ file: string; size: number }>
    }
    expect(systemInfo.nativeDumps).toEqual([
      expect.objectContaining({ file: 'memory.dmp', size: 14 })
    ])
  })

  it('degrades successfully when optional JSON inputs are corrupt', async () => {
    const userDataPath = makeUserDataDirectory()
    await mkdir(join(userDataPath, 'logs', 'crash'), { recursive: true })
    await mkdir(join(userDataPath, 'perf'), { recursive: true })
    await writeFile(join(userDataPath, 'logs', 'crash', 'crash-broken.json'), '{bad-json', 'utf8')
    await writeFile(join(userDataPath, 'perf', 'startup-history.json'), '{bad-json', 'utf8')

    const archive = await buildDiagnosticsArchive(exporterOptions(userDataPath))
    const zip = await JSZip.loadAsync(archive.data)
    const manifest = JSON.parse(await zipText(zip, 'manifest.json')) as {
      skipped: Array<{ source: string; reason: string }>
    }

    expect(await zipText(zip, 'system/system-info.json')).toContain('0.1.0')
    expect(manifest.skipped.some((entry) => entry.source.includes('crash-broken.json'))).toBe(true)
    expect(manifest.skipped.some((entry) => entry.source.includes('startup-history.json'))).toBe(true)
  })

  it('redacts absolute paths, file URLs, and content fields in structured diagnostics', async () => {
    const userDataPath = makeUserDataDirectory()
    const crashDirectory = join(userDataPath, 'logs', 'crash')
    const perfDirectory = join(userDataPath, 'perf')
    const recordFile = 'crash-20260715080000000-123-record-1.json'
    const record = crashRecord()
    record.error.message = 'failed in /home/alice/private-project and \\\\fileserver\\private\\workspace'
    record.error.stack = [
      'Error: failed',
      '    at file:///home/alice/private-project/src/main.ts:1:1',
      '    at file://fileserver/private/workspace/src/main.ts:2:1'
    ].join('\n')
    record.context.details = {
      prompt: 'private crash prompt',
      nested: { content: 'private crash content' }
    }
    record.context.renderer = { route: '/chat/thread-1' }
    await mkdir(crashDirectory, { recursive: true })
    await mkdir(perfDirectory, { recursive: true })
    await writeFile(join(crashDirectory, recordFile), JSON.stringify(record), 'utf8')
    await writeFile(
      join(perfDirectory, 'startup-history.json'),
      JSON.stringify([{
        scriptResources: {
          maxName: 'file:///home/alice/private-project/dist/renderer.js'
        },
        prompt: 'private startup prompt',
        content: 'private startup content'
      }]),
      'utf8'
    )

    const archive = await buildDiagnosticsArchive(exporterOptions(userDataPath))
    const zip = await JSZip.loadAsync(archive.data)
    const structuredText = [
      await zipText(zip, `crash/${recordFile}`),
      await zipText(zip, 'startup/startup-history.json')
    ].join('\n')

    expect(structuredText).not.toContain('/home/alice/private-project')
    expect(structuredText).not.toContain('file:///home/alice/private-project')
    expect(structuredText).not.toContain('fileserver')
    expect(structuredText).not.toContain('private crash prompt')
    expect(structuredText).not.toContain('private crash content')
    expect(structuredText).not.toContain('private startup prompt')
    expect(structuredText).not.toContain('private startup content')
    expect(structuredText).toContain('/chat/thread-1')
    expect(structuredText).toContain('<path-redacted>')
    expect(structuredText).toContain('<redacted>')
  })

  it('applies the aggregate limit to serialized archive input bytes', async () => {
    const userDataPath = makeUserDataDirectory()
    const perfDirectory = join(userDataPath, 'perf')
    const source = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({ at: index })))
    await mkdir(perfDirectory, { recursive: true })
    await writeFile(join(perfDirectory, 'startup-history.json'), source, 'utf8')

    const archive = await buildDiagnosticsArchive({
      ...exporterOptions(userDataPath),
      maxTotalBytes: Buffer.byteLength(source)
    })
    const zip = await JSZip.loadAsync(archive.data)

    expect(zip.file('startup/startup-history.json')).toBeNull()
    expect(archive.manifest.skipped).toContainEqual({
      source: 'perf/startup-history.json',
      reason: 'total-size-limit'
    })
  })

  it('includes runtime logs only from the current three-day window', async () => {
    const userDataPath = makeUserDataDirectory()
    const logDirectory = join(userDataPath, 'logs')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(join(logDirectory, 'kun-2026-07-15.log'), 'current', 'utf8')
    await writeFile(join(logDirectory, 'kun-2026-07-16.log'), 'future', 'utf8')
    await writeFile(join(logDirectory, 'kun-2026-07-99.log'), 'invalid-date', 'utf8')
    await writeFile(join(logDirectory, 'kun-2026-07-12.log'), 'too-old', 'utf8')

    const archive = await buildDiagnosticsArchive(exporterOptions(userDataPath))
    const zip = await JSZip.loadAsync(archive.data)
    const runtimeFiles = Object.values(zip.files)
      .filter((entry) => !entry.dir && entry.name.startsWith('runtime/'))
      .map((entry) => entry.name)

    expect(runtimeFiles).toEqual(['runtime/kun-2026-07-15.log'])
  })

  it.skipIf(process.platform === 'win32')('does not follow whitelisted-name symlinks', async () => {
    const userDataPath = makeUserDataDirectory()
    const logDirectory = join(userDataPath, 'logs')
    const secretPath = join(userDataPath, 'secure-store.json')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(secretPath, '{"apiKey":"symlink-secret"}', 'utf8')
    await symlink(secretPath, join(logDirectory, 'kun-2026-07-15.log'))

    const archive = await buildDiagnosticsArchive(exporterOptions(userDataPath))
    const zip = await JSZip.loadAsync(archive.data)
    const archiveText = await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => zipText(zip, entry.name))
    )

    expect(zip.file('runtime/kun-2026-07-15.log')).toBeNull()
    expect(archiveText.join('\n')).not.toContain('symlink-secret')
  })

  it('keeps log tails and enforces the aggregate archive-input limit', async () => {
    const userDataPath = makeUserDataDirectory()
    await mkdir(join(userDataPath, 'logs'), { recursive: true })
    await writeFile(
      join(userDataPath, 'logs', 'kun-2026-07-15.log'),
      `${'old-prefix-'.repeat(20)}TAIL-MARKER`,
      'utf8'
    )
    await writeFile(
      join(userDataPath, 'logs', 'kun-2026-07-14.log'),
      `${'older-prefix-'.repeat(20)}OLDER-TAIL`,
      'utf8'
    )

    const archive = await buildDiagnosticsArchive({
      ...exporterOptions(userDataPath),
      maxFileBytes: 64,
      maxTotalBytes: 64
    })
    const zip = await JSZip.loadAsync(archive.data)
    const manifest = JSON.parse(await zipText(zip, 'manifest.json')) as {
      included: Array<{ path: string; includedBytes: number; truncated: boolean }>
      skipped: Array<{ source: string; reason: string }>
    }
    const runtimeFiles = Object.values(zip.files)
      .filter((entry) => !entry.dir && entry.name.startsWith('runtime/'))

    expect(runtimeFiles).toHaveLength(1)
    expect(await zipText(zip, runtimeFiles[0]?.name ?? '')).toContain('TAIL-MARKER')
    expect(manifest.included.find((entry) => entry.path.startsWith('runtime/'))).toMatchObject({
      includedBytes: 64,
      truncated: true
    })
    expect(manifest.skipped.some((entry) => entry.reason === 'total-size-limit')).toBe(true)
  })
})

describe('exportDiagnostics', () => {
  it('returns a canceled result without creating an archive', async () => {
    const userDataPath = makeUserDataDirectory()
    const result = await exportDiagnostics({
      ...exporterOptions(userDataPath),
      showSaveDialog: async () => ({ canceled: true })
    })

    expect(result).toEqual({ ok: false, canceled: true })
  })

  it('atomically writes the selected zip and returns its path', async () => {
    const userDataPath = makeUserDataDirectory()
    const destinationPath = join(userDataPath, 'exports', 'diagnostics.zip')
    let dialogOptions: { defaultPath: string; filters: Array<{ name: string; extensions: string[] }> } | null = null

    const result = await exportDiagnostics({
      ...exporterOptions(userDataPath),
      showSaveDialog: async (options) => {
        dialogOptions = options
        return { canceled: false, filePath: destinationPath }
      }
    })

    expect(result).toEqual({ ok: true, path: destinationPath })
    expect(dialogOptions).toMatchObject({
      defaultPath: expect.stringMatching(/Claude360-Copilot-diagnostics-\d{8}-\d{6}\.zip$/),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
    })
    expect(existsSync(destinationPath)).toBe(true)
    expect(existsSync(`${destinationPath}.tmp`)).toBe(false)
  })
})
