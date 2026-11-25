import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PPT_MASTER_BUNDLED_DIR_ENV,
  PPT_MASTER_LOCAL_DIR_ENV,
  PPT_MASTER_PACKAGE,
  PPT_MASTER_PACKAGE_ENV
} from '../../shared/ppt-master'
import {
  pptMasterBundledRoots,
  pptMasterPackageName,
  pptMasterSkillRoot,
  pptMasterSkillState,
  pptMasterVersionDir,
  resolveLocalSkillDir,
  verifyIntegrity
} from './ppt-master-installer'

describe('ppt-master installer', () => {
  let root = ''
  /**
   * The repo really does carry a bundled skill at packages/ppt-master-skill,
   * and bundle resolution defaults to cwd — so tests about the *download*
   * channel must explicitly point the bundle lookup at nothing.
   */
  let noBundle: NodeJS.ProcessEnv = {}

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ppt-master-test-'))
    noBundle = { [PPT_MASTER_BUNDLED_DIR_ENV]: join(root, 'absent-bundle') }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('verifyIntegrity', () => {
    it('accepts a matching sha512 digest and rejects a mismatched one', () => {
      const digest = createHash('sha512').update('payload').digest()
      const integrity = `sha512-${digest.toString('base64')}`

      expect(() => verifyIntegrity(integrity, digest)).not.toThrow()
      expect(() => verifyIntegrity(integrity, createHash('sha512').update('other').digest()))
        .toThrow(/integrity check/i)
    })

    it('rejects metadata without a sha512 entry', () => {
      const digest = createHash('sha512').update('payload').digest()
      expect(() => verifyIntegrity('sha1-abc', digest)).toThrow(/sha512/i)
    })
  })

  describe('resolveLocalSkillDir', () => {
    it('accepts the package directory itself', async () => {
      await writeFile(join(root, 'SKILL.md'), '# skill', 'utf8')

      await expect(resolveLocalSkillDir(root)).resolves.toEqual({
        ok: true,
        root,
        skillDir: root
      })
    })

    it('accepts a parent holding a ppt-master package directory', async () => {
      const nested = join(root, 'ppt-master')
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'SKILL.md'), '# skill', 'utf8')

      await expect(resolveLocalSkillDir(root)).resolves.toEqual({
        ok: true,
        root,
        skillDir: nested
      })
    })

    it('reports a directory with no SKILL.md anywhere it looked', async () => {
      const result = await resolveLocalSkillDir(root)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.message).toMatch(/SKILL\.md/)
    })
  })

  describe('pptMasterSkillState', () => {
    it('reports missing when nothing has been installed', async () => {
      await expect(pptMasterSkillState(root, noBundle)).resolves.toMatchObject({ status: 'missing' })
      await expect(pptMasterSkillRoot(root, noBundle)).resolves.toBeUndefined()
    })

    it('prefers a local directory override over any downloaded copy', async () => {
      const localDir = join(root, 'checkout', 'skills')
      const skillDir = join(localDir, 'ppt-master')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), [
        '---',
        'name: ppt-master',
        'metadata:',
        '  version: "4.8.0"',
        '---',
        '',
        'body'
      ].join('\n'), 'utf8')

      const state = await pptMasterSkillState(root, { [PPT_MASTER_LOCAL_DIR_ENV]: localDir })

      expect(state).toMatchObject({ status: 'ready', local: true, root: localDir, skillDir })
      expect(state.version).toBe('4.8.0')
      await expect(pptMasterSkillRoot(root, { [PPT_MASTER_LOCAL_DIR_ENV]: localDir }))
        .resolves.toBe(localDir)
    })

    it('surfaces a bad local override as an error rather than falling back', async () => {
      const state = await pptMasterSkillState(root, {
        [PPT_MASTER_LOCAL_DIR_ENV]: join(root, 'nope')
      })

      expect(state.status).toBe('error')
      expect(state.message).toMatch(/SKILL\.md/)
    })

    it('treats a recorded install whose files vanished as missing', async () => {
      await mkdir(join(root, 'ppt-master'), { recursive: true })
      await writeFile(
        join(root, 'ppt-master', 'installed.json'),
        JSON.stringify({
          version: '4.8.0',
          packageName: PPT_MASTER_PACKAGE,
          installedAt: new Date().toISOString()
        }),
        'utf8'
      )

      await expect(pptMasterSkillState(root, noBundle)).resolves.toMatchObject({
        status: 'missing',
        version: '4.8.0'
      })
    })

    it('reports ready once the package directory is on disk', async () => {
      const versionDir = pptMasterVersionDir(root, '4.8.0')
      const skillDir = join(versionDir, 'ppt-master')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), '# skill', 'utf8')
      await mkdir(join(root, 'ppt-master'), { recursive: true })
      await writeFile(
        join(root, 'ppt-master', 'installed.json'),
        JSON.stringify({
          version: '4.8.0',
          packageName: PPT_MASTER_PACKAGE,
          installedAt: new Date().toISOString()
        }),
        'utf8'
      )

      await expect(pptMasterSkillState(root, noBundle)).resolves.toMatchObject({
        status: 'ready',
        version: '4.8.0',
        root: versionDir,
        skillDir
      })
    })
  })

  describe('bundled skill', () => {
    async function writeBundle(bundleRoot: string): Promise<string> {
      const skillDir = join(bundleRoot, 'ppt-master')
      await mkdir(skillDir, { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), [
        '---',
        'name: ppt-master',
        'metadata:',
        '  version: "4.8.0"',
        '---',
        '',
        'body'
      ].join('\n'), 'utf8')
      return skillDir
    }

    it('resolves the bundle without any download or manifest', async () => {
      const bundleRoot = join(root, 'resources', 'ppt-master-skill')
      const skillDir = await writeBundle(bundleRoot)

      const state = await pptMasterSkillState(root, {
        [PPT_MASTER_BUNDLED_DIR_ENV]: bundleRoot
      })

      expect(state).toMatchObject({
        status: 'ready',
        source: 'bundled',
        local: true,
        root: bundleRoot,
        skillDir,
        version: '4.8.0'
      })
    })

    it('hands Kun the parent directory as the scan root, not the package', async () => {
      const bundleRoot = join(root, 'resources', 'ppt-master-skill')
      await writeBundle(bundleRoot)

      // Kun scans a root's direct children for SKILL.md; pointing it at the
      // package directory itself would surface nothing.
      await expect(pptMasterSkillRoot(root, { [PPT_MASTER_BUNDLED_DIR_ENV]: bundleRoot }))
        .resolves.toBe(bundleRoot)
    })

    it('lets an explicit local override win over the bundle', async () => {
      const bundleRoot = join(root, 'resources', 'ppt-master-skill')
      await writeBundle(bundleRoot)
      const localDir = join(root, 'checkout', 'skills')
      const localSkillDir = join(localDir, 'ppt-master')
      await mkdir(localSkillDir, { recursive: true })
      await writeFile(join(localSkillDir, 'SKILL.md'), '# skill', 'utf8')

      const state = await pptMasterSkillState(root, {
        [PPT_MASTER_BUNDLED_DIR_ENV]: bundleRoot,
        [PPT_MASTER_LOCAL_DIR_ENV]: localDir
      })

      expect(state).toMatchObject({ status: 'ready', source: 'local', root: localDir })
    })

    it('falls back to the download channel when no bundle is present', async () => {
      const state = await pptMasterSkillState(root, noBundle)

      expect(state.status).toBe('missing')
      expect(state.source).toBeUndefined()
    })

    it('looks in packaged resources before the repo staging directory', () => {
      const roots = pptMasterBundledRoots({}, {
        resourcesPath: '/Apps/Copilot.app/Contents/Resources',
        appDir: '/repo'
      })

      expect(roots).toEqual([
        join('/Apps/Copilot.app/Contents/Resources', 'ppt-master-skill'),
        join('/repo', 'packages', 'ppt-master-skill')
      ])
    })

    it('honours an explicit bundle directory to the exclusion of the defaults', () => {
      const roots = pptMasterBundledRoots(
        { [PPT_MASTER_BUNDLED_DIR_ENV]: '/custom/bundle' },
        { resourcesPath: '/res', appDir: '/repo' }
      )

      expect(roots).toEqual(['/custom/bundle'])
    })
  })

  describe('pptMasterPackageName', () => {
    it('defaults to the published package and honours an override', () => {
      expect(pptMasterPackageName({})).toBe(PPT_MASTER_PACKAGE)
      expect(pptMasterPackageName({ [PPT_MASTER_PACKAGE_ENV]: '@acme/fork' })).toBe('@acme/fork')
    })
  })
})
