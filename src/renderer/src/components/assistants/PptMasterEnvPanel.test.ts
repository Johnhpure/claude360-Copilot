import { describe, expect, it } from 'vitest'
import en from '../../locales/en/common.json'
import zh from '../../locales/zh/common.json'
import {
  formatProgress,
  pythonDetail,
  rowStatusForPython,
  rowStatusForSkill,
  skillDetail
} from './PptMasterEnvPanel'

/** Echoes the key so assertions read against keys, not translated copy. */
const translate = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}:${JSON.stringify(options)}` : key

describe('PptMasterEnvPanel display logic', () => {
  describe('row status', () => {
    it('maps each skill status onto the right indicator', () => {
      expect(rowStatusForSkill(undefined)).toBe('pending')
      expect(rowStatusForSkill({ status: 'missing' })).toBe('pending')
      expect(rowStatusForSkill({ status: 'downloading' })).toBe('busy')
      expect(rowStatusForSkill({ status: 'extracting' })).toBe('busy')
      expect(rowStatusForSkill({ status: 'verifying' })).toBe('busy')
      expect(rowStatusForSkill({ status: 'ready' })).toBe('ready')
      expect(rowStatusForSkill({ status: 'error' })).toBe('error')
    })

    it('maps each python status onto the right indicator', () => {
      expect(rowStatusForPython(undefined)).toBe('pending')
      expect(rowStatusForPython({ status: 'missing' })).toBe('pending')
      expect(rowStatusForPython({ status: 'installing' })).toBe('busy')
      expect(rowStatusForPython({ status: 'ready' })).toBe('ready')
      expect(rowStatusForPython({ status: 'error' })).toBe('error')
    })
  })

  describe('skillDetail', () => {
    it('shows the installed version once ready', () => {
      expect(skillDetail({ status: 'ready', version: '4.8.0' }, translate)).toBe('v4.8.0')
    })

    it('shows download progress with a total when the server sent one', () => {
      const detail = skillDetail(
        { status: 'downloading', receivedBytes: 12 * 1024 * 1024, totalBytes: 116 * 1024 * 1024 },
        translate
      )
      expect(detail).toContain('12.0 MB / 116.0 MB')
    })

    it('prefers a real error message over the generic label', () => {
      expect(skillDetail({ status: 'error', message: 'network down' }, translate))
        .toBe('network down')
      expect(skillDetail({ status: 'error' }, translate)).toBe('pptMasterEnvError')
    })
  })

  describe('pythonDetail', () => {
    it('shows the interpreter version once ready and the live pip line while installing', () => {
      expect(pythonDetail({ status: 'ready', version: '3.12.1' }, translate)).toBe('Python 3.12.1')
      expect(pythonDetail({ status: 'installing', progress: 'Collecting numpy' }, translate))
        .toBe('Collecting numpy')
    })

    it('counts missing modules when the venv exists but is incomplete', () => {
      expect(pythonDetail({ status: 'missing', missingModules: ['pptx', 'fitz'] }, translate))
        .toBe('pptMasterEnvMissingModules:{"count":2}')
      expect(pythonDetail({ status: 'missing' }, translate)).toBe('pptMasterEnvMissing')
    })
  })

  describe('formatProgress', () => {
    it('falls back to the received size when no total is known', () => {
      expect(formatProgress({ status: 'downloading', receivedBytes: 5 * 1024 * 1024 }))
        .toBe('5.0 MB')
      expect(formatProgress({ status: 'downloading', receivedBytes: 2048, totalBytes: null }))
        .toBe('2 KB')
      expect(formatProgress({ status: 'downloading', receivedBytes: 512 })).toBe('512 B')
    })
  })

  it('has every panel key translated in both locales', () => {
    const keys = [
      'pptMasterEnvTitle',
      'pptMasterEnvSkill',
      'pptMasterEnvPython',
      'pptMasterEnvReady',
      'pptMasterEnvMissing',
      'pptMasterEnvMissingModules',
      'pptMasterEnvChecking',
      'pptMasterEnvDownloading',
      'pptMasterEnvExtracting',
      'pptMasterEnvVerifying',
      'pptMasterEnvInstalling',
      'pptMasterEnvError',
      'pptMasterEnvInstall',
      'pptMasterEnvRepair',
      'pptMasterEnvRecheck',
      'pptMasterEnvAutoHint',
      'pptMasterEnvSandboxHint'
    ]
    const zhMessages = zh as unknown as Record<string, unknown>
    const enMessages = en as unknown as Record<string, unknown>
    for (const key of keys) {
      expect(typeof zhMessages[key], `zh is missing ${key}`).toBe('string')
      expect(typeof enMessages[key], `en is missing ${key}`).toBe('string')
    }
  })
})
