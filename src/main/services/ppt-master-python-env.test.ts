import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSupportedVersion,
  parseProbeOutput,
  pptMasterVenvBinDir,
  pptMasterVenvInterpreter,
  withPptMasterPython
} from './ppt-master-python-env'
import { PPT_MASTER_PROBE_MODULES } from '../../shared/ppt-master'

const MARKER = '__ppt_master_probe__:'

const USER_DATA = '/tmp/user-data'

describe('ppt-master python env', () => {
  describe('venv layout', () => {
    it('uses bin/python3 on POSIX and Scripts/python.exe on Windows', () => {
      expect(pptMasterVenvBinDir(USER_DATA, 'darwin'))
        .toBe(join(USER_DATA, 'ppt-master', 'venv', 'bin'))
      expect(pptMasterVenvInterpreter(USER_DATA, 'darwin'))
        .toBe(join(USER_DATA, 'ppt-master', 'venv', 'bin', 'python3'))
      expect(pptMasterVenvInterpreter(USER_DATA, 'win32'))
        .toBe(join(USER_DATA, 'ppt-master', 'venv', 'Scripts', 'python.exe'))
    })
  })

  describe('parseProbeOutput', () => {
    it('reports nothing missing when every import succeeded', () => {
      expect(parseProbeOutput(`${MARKER}\n`)).toEqual([])
    })

    it('reads the modules that failed to import', () => {
      expect(parseProbeOutput(`${MARKER}pptx,fitz\n`)).toEqual(['pptx', 'fitz'])
    })

    // PyMuPDF prints its `fitz` deprecation notice to *stdout*, not just stderr.
    // Parsing the whole stream counted that sentence as one missing module and
    // reported a fully working venv as "1 of 7 required packages are missing".
    it('ignores chatter printed by the modules themselves', () => {
      const stdout = [
        'warning: The `fitz` API is deprecated and will be removed in future.',
        `${MARKER}`,
        ''
      ].join('\n')

      expect(parseProbeOutput(stdout)).toEqual([])
    })

    it('treats a missing marker as nothing verified', () => {
      expect(parseProbeOutput('Traceback (most recent call last):\n'))
        .toEqual([...PPT_MASTER_PROBE_MODULES])
    })
  })

  describe('withPptMasterPython', () => {
    it('prepends the venv to PATH and pins an explicit interpreter', () => {
      const binDir = pptMasterVenvBinDir(USER_DATA, 'darwin')

      const env = withPptMasterPython({ PATH: '/usr/bin' }, USER_DATA, { platform: 'darwin' })

      expect(env.PATH).toBe(`${binDir}${delimiter}/usr/bin`)
      expect(env.PPT_MASTER_PYTHON).toBe(pptMasterVenvInterpreter(USER_DATA, 'darwin'))
    })

    it('leaves the env untouched when the venv is absent', () => {
      const original = { PATH: '/usr/bin' }

      const env = withPptMasterPython(original, USER_DATA, { platform: 'darwin', exists: false })

      expect(env).toBe(original)
    })

    it('does not stack duplicate entries across restarts', () => {
      const first = withPptMasterPython({ PATH: '/usr/bin' }, USER_DATA, { platform: 'darwin' })

      const second = withPptMasterPython(first, USER_DATA, { platform: 'darwin' })

      expect(second).toBe(first)
      expect(second.PATH?.split(delimiter).filter((entry) => entry.includes('venv'))).toHaveLength(1)
    })

    it('updates the existing PATH key casing on Windows', () => {
      const env = withPptMasterPython({ Path: 'C:\\Windows' }, USER_DATA, { platform: 'win32' })

      expect(env.Path).toContain(pptMasterVenvBinDir(USER_DATA, 'win32'))
      expect(env.PATH).toBeUndefined()
    })

    it('handles an empty PATH without emitting a leading separator', () => {
      const env = withPptMasterPython({}, USER_DATA, { platform: 'darwin' })

      expect(env.PATH).toBe(pptMasterVenvBinDir(USER_DATA, 'darwin'))
    })
  })

  describe('isSupportedVersion', () => {
    it('requires Python 3.9 or newer', () => {
      expect(isSupportedVersion('3.12.1')).toBe(true)
      expect(isSupportedVersion('3.9.0')).toBe(true)
      expect(isSupportedVersion('3.8.10')).toBe(false)
      expect(isSupportedVersion('2.7.18')).toBe(false)
      expect(isSupportedVersion('not a version')).toBe(false)
    })
  })
})
