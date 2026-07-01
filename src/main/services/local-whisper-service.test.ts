import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => 'test')
  }
}))

import { app } from 'electron'
import { LOCAL_WHISPER_MODELS, LOCAL_WHISPER_SMALL_MODEL_ID, localWhisperModelById } from '../../shared/local-whisper'
import { _internals, getLocalWhisperModelStatus } from './local-whisper-service'

describe('local-whisper-service helpers', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-local-whisper-'))
    vi.mocked(app.getPath).mockReturnValue(rootDir)
    _internals.setLocalWhisperDownloadStateForTest(null)
  })

  it('keeps checksum metadata for every downloadable model', () => {
    for (const model of LOCAL_WHISPER_MODELS) {
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(model.downloadUrl).toContain('https://huggingface.co/')
      expect(model.downloadMirrors.some((mirror) => mirror.downloadUrl.includes('https://hf-mirror.com/'))).toBe(true)
      expect(model.downloadMirrors.some((mirror) => mirror.downloadUrl.includes('https://hf-cdn.sufy.com/'))).toBe(true)
    }
  })

  it('resolves the selected model download source', () => {
    const model = localWhisperModelById(LOCAL_WHISPER_SMALL_MODEL_ID)

    expect(_internals.localWhisperDownloadUrl(model, 'huggingface')).toBe(model.downloadUrl)
    expect(_internals.localWhisperDownloadUrl(model, 'hf-mirror')).toContain('https://hf-mirror.com/')
    expect(_internals.localWhisperDownloadUrl(model, 'hf-sufy')).toContain('https://hf-cdn.sufy.com/')
  })

  it('keeps a well-formed Whisper runner for the committed baseline platform', () => {
    // 仓库只随源码跟踪基线平台（win32-x64）的 whisper runner；其余平台由
    // scripts/prepare-whisper-runner.cjs 在对应 OS/CI 上原生构建（见 before-pack.cjs），
    // 不进仓库（体积大且无法跨平台交叉编译）。此单测校验：
    //   1) 基线 runner 结构完整（runner.json + 可执行文件 > 64KB）；
    //   2) 任何“已存在”的其它平台 runner 也必须完整（防止误提交损坏资源）。
    // 发布期的全目标平台覆盖由打包流水线（before-pack + prepare-whisper-runner）保证，
    // 不在此弱化——本测试只针对当前仓库实际跟踪/存在的资源。
    const whisperDir = join(process.cwd(), 'resources', 'whisper')
    const executableFor = (platformDir: string): string =>
      platformDir.startsWith('win32') ? 'whisper-cli.exe' : 'whisper-cli'
    const assertRunnerDir = (platformDir: string): void => {
      const runnerDir = join(whisperDir, platformDir)
      const runnerPath = join(runnerDir, executableFor(platformDir))
      expect(existsSync(join(runnerDir, 'runner.json'))).toBe(true)
      expect(existsSync(runnerPath)).toBe(true)
      expect(statSync(runnerPath).size).toBeGreaterThan(64 * 1024)
    }

    // 基线 runner 必须存在且完整。
    assertRunnerDir('win32-x64')

    // 其它已存在的平台 runner 目录也必须完整（存在即校验，不强制齐全）。
    const presentPlatformDirs = readdirSync(whisperDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^(darwin|win32|linux)-(arm64|x64)$/.test(entry.name))
      .map((entry) => entry.name)
    for (const platformDir of presentPlatformDirs) assertRunnerDir(platformDir)
  })

  it('computes sha256 checksums for downloaded files', async () => {
    const path = join(rootDir, 'sample.bin')
    await writeFile(path, 'abc', 'utf8')

    await expect(_internals.fileSha256(path)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('reports ready when the model file exists even if the last progress is complete', async () => {
    const model = localWhisperModelById(LOCAL_WHISPER_SMALL_MODEL_ID)
    const path = _internals.localWhisperModelPath(model.id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'ready', 'utf8')
    _internals.setLocalWhisperDownloadStateForTest({
      modelId: model.id,
      downloadedBytes: model.sizeBytes,
      totalBytes: model.sizeBytes,
      speedBytesPerSecond: 1024
    })

    const status = await getLocalWhisperModelStatus(model.id)

    expect(status.state).toBe('ready')
    expect(status.path).toBe(path)
  })
})
