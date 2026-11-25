/**
 * Resolution and provisioning for the PPT Master skill package.
 *
 * Normally the skill ships bundled with the app, so nothing is downloaded and
 * the assistant works on first launch and offline. The npm download remains as
 * a fallback for builds that deliberately omit the ~13k-file bundle; it lands
 * in a versioned userData directory:
 *
 *   <userData>/ppt-master/versions/<version>/     <- scan root given to Kun
 *   <userData>/ppt-master/versions/<version>/ppt-master/SKILL.md
 *   <userData>/ppt-master/installed.json
 *
 * Kun's skill discovery scans a root's direct children for `SKILL.md`, so
 * handing it the version directory surfaces exactly one skill package. The
 * bundled layout mirrors this: the root is the directory *containing*
 * `ppt-master/`, never the package directory itself.
 *
 * Nothing inside the package may be modified: its SKILL.md runs
 * `scripts/attribution_guard.py` as a mandatory second step and refuses to
 * continue if the distribution was altered. We run that same script after
 * extraction as the integrity check, which is stricter and more meaningful
 * than re-hashing files ourselves.
 */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import {
  PPT_MASTER_BUNDLED_DIR_ENV,
  PPT_MASTER_BUNDLE_DIR_NAME,
  PPT_MASTER_LOCAL_DIR_ENV,
  PPT_MASTER_PACKAGE,
  PPT_MASTER_PACKAGE_ENV,
  PPT_MASTER_SKILL_DIR_NAME,
  PPT_MASTER_VERSION,
  type PptMasterSkillState
} from '../../shared/ppt-master'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import { logInfo, logWarn } from '../logger'
import { ProcessRunError, errorText, runProcess } from './ppt-master-process'

const REGISTRY = 'https://registry.npmjs.org'
const METADATA_TIMEOUT_MS = 20_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const EXTRACT_TIMEOUT_MS = 10 * 60_000
const GUARD_TIMEOUT_MS = 60_000
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

const InstalledManifestSchema = z.object({
  version: z.string().min(1),
  packageName: z.string().min(1),
  installedAt: z.string().min(1),
  integrity: z.string().optional()
})
type InstalledManifest = z.infer<typeof InstalledManifestSchema>

const NpmMetadataSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  dist: z.object({
    tarball: z.string().url(),
    integrity: z.string().min(1)
  })
})

export function pptMasterRootDir(userDataDir: string): string {
  return join(userDataDir, 'ppt-master')
}

export function pptMasterVersionDir(userDataDir: string, version: string): string {
  return join(pptMasterRootDir(userDataDir), 'versions', version)
}

function installedManifestPath(userDataDir: string): string {
  return join(pptMasterRootDir(userDataDir), 'installed.json')
}

export function pptMasterPackageName(env: NodeJS.ProcessEnv = process.env): string {
  return env[PPT_MASTER_PACKAGE_ENV]?.trim() || PPT_MASTER_PACKAGE
}

/**
 * Resolve a developer-supplied skill directory. Accepts either the package
 * directory itself (holds `SKILL.md`) or a parent that contains a `ppt-master`
 * package directory, so pointing at a repository's `skills/` folder works.
 */
export async function resolveLocalSkillDir(dir: string): Promise<
  { ok: true; root: string; skillDir: string } | { ok: false; message: string }
> {
  const root = resolve(dir)
  if (await pathExists(join(root, 'SKILL.md'))) return { ok: true, root, skillDir: root }
  const nested = join(root, PPT_MASTER_SKILL_DIR_NAME)
  if (await pathExists(join(nested, 'SKILL.md'))) return { ok: true, root, skillDir: nested }
  return {
    ok: false,
    message: `${PPT_MASTER_LOCAL_DIR_ENV} does not contain a SKILL.md (checked ${root} and ${nested})`
  }
}

/**
 * Where the app-bundled copy may live, in priority order. In a packaged app it
 * sits beside the other extra resources; in the repo it is the staging
 * directory that `scripts/prepare-ppt-master-package.mjs` fills.
 *
 * Each candidate is a *scan root* — the directory containing `ppt-master/`.
 */
export function pptMasterBundledRoots(
  env: NodeJS.ProcessEnv = process.env,
  paths: { resourcesPath?: string; appDir?: string } = {}
): string[] {
  const explicit = env[PPT_MASTER_BUNDLED_DIR_ENV]?.trim()
  if (explicit) return [resolve(explicit)]

  const resourcesPath = paths.resourcesPath ?? process.resourcesPath
  const appDir = paths.appDir ?? process.cwd()
  const roots: string[] = []
  if (resourcesPath) roots.push(join(resourcesPath, PPT_MASTER_BUNDLE_DIR_NAME))
  roots.push(join(appDir, 'packages', PPT_MASTER_BUNDLE_DIR_NAME))
  return roots
}

async function resolveBundledSkill(
  env: NodeJS.ProcessEnv
): Promise<{ root: string; skillDir: string } | null> {
  for (const root of pptMasterBundledRoots(env)) {
    const skillDir = join(root, PPT_MASTER_SKILL_DIR_NAME)
    if (await pathExists(join(skillDir, 'SKILL.md'))) return { root, skillDir }
  }
  return null
}

/**
 * Current skill state, resolved through the three channels in order: developer
 * override, app bundle, downloaded package. The override wins so a developer
 * pointing at a checkout always sees the checkout; the bundle wins over a
 * download because it is the copy this app release was verified against.
 */
export async function pptMasterSkillState(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<PptMasterSkillState> {
  const localDir = env[PPT_MASTER_LOCAL_DIR_ENV]?.trim()
  if (localDir) {
    const resolved = await resolveLocalSkillDir(localDir)
    if (!resolved.ok) return { status: 'error', local: true, source: 'local', message: resolved.message }
    return {
      status: 'ready',
      local: true,
      source: 'local',
      root: resolved.root,
      skillDir: resolved.skillDir,
      version: await readLocalVersion(resolved.skillDir)
    }
  }

  const bundled = await resolveBundledSkill(env)
  if (bundled) {
    return {
      status: 'ready',
      local: true,
      source: 'bundled',
      root: bundled.root,
      skillDir: bundled.skillDir,
      version: (await readLocalVersion(bundled.skillDir)) ?? PPT_MASTER_VERSION
    }
  }

  const manifest = await readInstalledManifest(userDataDir)
  if (!manifest) return { status: 'missing' }
  const root = pptMasterVersionDir(userDataDir, manifest.version)
  const skillDir = join(root, PPT_MASTER_SKILL_DIR_NAME)
  if (!(await pathExists(join(skillDir, 'SKILL.md')))) {
    return {
      status: 'missing',
      version: manifest.version,
      message: 'the recorded install is missing on disk'
    }
  }
  return { status: 'ready', source: 'download', version: manifest.version, root, skillDir }
}

/**
 * Scan root for the Kun skill runtime, or undefined when nothing is installed.
 * Kept separate from the full state so callers on the hot path (runtime spawn,
 * skill-root assembly) do not pay for the richer status shape.
 */
export async function pptMasterSkillRoot(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const state = await pptMasterSkillState(userDataDir, env)
  return state.status === 'ready' ? state.root : undefined
}

export type InstallPptMasterOptions = {
  userDataDir: string
  version?: string
  proxyUrl?: string
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  onState?: (state: PptMasterSkillState) => void
  /** Injected in tests to avoid touching the network. */
  fetcher?: typeof fetchWithOptionalProxy
}

export async function installPptMasterSkill(
  options: InstallPptMasterOptions
): Promise<PptMasterSkillState> {
  const env = options.env ?? process.env
  const onDisk = await pptMasterSkillState(options.userDataDir, env)
  if (onDisk.source === 'local' || onDisk.source === 'bundled') {
    // Nothing to install: the override or the app bundle is already on disk.
    // Report it so a caller that triggered "install" still sees the outcome.
    options.onState?.(onDisk)
    return onDisk
  }

  const version = options.version ?? PPT_MASTER_VERSION
  const packageName = pptMasterPackageName(env)
  const report = (state: PptMasterSkillState): PptMasterSkillState => {
    options.onState?.(state)
    return state
  }

  const root = pptMasterRootDir(options.userDataDir)
  const downloadsDir = join(root, 'downloads')
  const archivePath = join(downloadsDir, `${hashKey(packageName, version)}.tgz.part`)
  const stagingDir = join(root, `staging-${randomUUID()}`)
  const targetDir = pptMasterVersionDir(options.userDataDir, version)

  try {
    await mkdir(downloadsDir, { recursive: true })
    report({ status: 'downloading', version, receivedBytes: 0, totalBytes: null })

    const metadata = await fetchPackageMetadata({
      packageName,
      version,
      proxyUrl: options.proxyUrl ?? '',
      signal: options.signal,
      fetcher: options.fetcher ?? fetchWithOptionalProxy
    })

    const digest = await downloadArchive({
      url: metadata.dist.tarball,
      archivePath,
      proxyUrl: options.proxyUrl ?? '',
      signal: options.signal,
      fetcher: options.fetcher ?? fetchWithOptionalProxy,
      onProgress: (receivedBytes, totalBytes) =>
        report({ status: 'downloading', version, receivedBytes, totalBytes })
    })
    verifyIntegrity(metadata.dist.integrity, digest)

    report({ status: 'extracting', version })
    await rm(stagingDir, { recursive: true, force: true })
    await mkdir(stagingDir, { recursive: true })
    await assertArchivePathsAreSafe(archivePath)
    await runProcess('tar', ['-xzf', archivePath, '-C', stagingDir, '--strip-components=1'], {
      timeoutMs: EXTRACT_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {})
    })

    const stagedSkillDir = join(stagingDir, PPT_MASTER_SKILL_DIR_NAME)
    if (!(await pathExists(join(stagedSkillDir, 'SKILL.md')))) {
      throw new Error(`package ${packageName}@${version} has no ${PPT_MASTER_SKILL_DIR_NAME}/SKILL.md`)
    }

    report({ status: 'verifying', version })
    await verifyAttribution(stagedSkillDir, options.signal)

    await mkdir(dirname(targetDir), { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    await rename(stagingDir, targetDir)
    await writeInstalledManifest(options.userDataDir, {
      version,
      packageName,
      installedAt: new Date().toISOString(),
      integrity: metadata.dist.integrity
    })
    await rm(archivePath, { force: true }).catch(() => undefined)

    logInfo('ppt-master', `skill installed: ${packageName}@${version}`)
    return report({
      status: 'ready',
      source: 'download',
      version,
      root: targetDir,
      skillDir: join(targetDir, PPT_MASTER_SKILL_DIR_NAME)
    })
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    const message = errorText(error)
    logWarn('ppt-master', `skill install failed: ${packageName}@${version}`, message)
    return report({ status: 'error', version, message })
  }
}

export async function uninstallPptMasterSkill(userDataDir: string): Promise<void> {
  await rm(pptMasterRootDir(userDataDir), { recursive: true, force: true })
}

async function fetchPackageMetadata(input: {
  packageName: string
  version: string
  proxyUrl: string
  signal?: AbortSignal
  fetcher: typeof fetchWithOptionalProxy
}): Promise<z.infer<typeof NpmMetadataSchema>> {
  const url = `${REGISTRY}/${input.packageName.replace('/', '%2F')}/${encodeURIComponent(input.version)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await input.fetcher(
      url,
      { signal: controller.signal, headers: { accept: 'application/json' } },
      input.proxyUrl
    )
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? `${input.packageName}@${input.version} was not found on the npm registry`
          : `npm registry returned ${response.status} for ${input.packageName}@${input.version}`
      )
    }
    return NpmMetadataSchema.parse(await response.json())
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

async function downloadArchive(input: {
  url: string
  archivePath: string
  proxyUrl: string
  signal?: AbortSignal
  fetcher: typeof fetchWithOptionalProxy
  onProgress: (receivedBytes: number, totalBytes: number | null) => void
}): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  input.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await input.fetcher(input.url, { signal: controller.signal }, input.proxyUrl)
    if (!response.ok) throw new Error(`tarball download failed with status ${response.status}`)
    if (!response.body) throw new Error('tarball response had no body')

    const lengthHeader = response.headers.get('content-length')
    const totalBytes = lengthHeader ? Number.parseInt(lengthHeader, 10) : null
    const hash = createHash('sha512')
    let received = 0
    let lastReported = 0

    const source = async function* (): AsyncGenerator<Buffer> {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk)
        received += buffer.byteLength
        if (received > MAX_ARCHIVE_BYTES) throw new Error('tarball exceeded the size limit')
        hash.update(buffer)
        // Report roughly every 4MB so a 100MB download stays chatty but cheap.
        if (received - lastReported >= 4 * 1024 * 1024) {
          lastReported = received
          input.onProgress(received, Number.isFinite(totalBytes) ? totalBytes : null)
        }
        yield buffer
      }
    }

    await pipeline(source(), createWriteStream(input.archivePath))
    input.onProgress(received, Number.isFinite(totalBytes) ? totalBytes : null)
    return hash.digest()
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onAbort)
  }
}

export function verifyIntegrity(integrity: string, digest: Buffer): void {
  const token = integrity.trim().split(/\s+/).find((entry) => entry.startsWith('sha512-'))
  if (!token) throw new Error('npm metadata did not provide a sha512 integrity value')
  const expected = Buffer.from(token.slice('sha512-'.length), 'base64')
  if (expected.byteLength !== digest.byteLength || !expected.equals(digest)) {
    throw new Error('downloaded tarball failed its integrity check')
  }
}

/**
 * Reject archives with absolute or traversing entries before extraction. The
 * listing for this package is ~13k lines, so it is filtered in the shell rather
 * than read into memory — only offending paths come back.
 */
async function assertArchivePathsAreSafe(archivePath: string): Promise<void> {
  try {
    const { stdout } = await runProcess(
      'sh',
      ['-c', `tar -tzf "${archivePath}" | grep -E '^/|(^|/)\\.\\.(/|$)' | head -5 || true`],
      { timeoutMs: EXTRACT_TIMEOUT_MS }
    )
    if (stdout.trim()) throw new Error(`archive contains unsafe paths: ${stdout.trim()}`)
  } catch (error) {
    if (error instanceof ProcessRunError && error.kind === 'spawn') {
      // No POSIX shell (Windows): tar itself strips leading slashes and refuses
      // `..` members, and the tarball already passed its sha512 check.
      logWarn('ppt-master', 'archive path scan skipped', error.message)
      return
    }
    throw error
  }
}

/**
 * Run the skill's own integrity gate. This is the same check its SKILL.md
 * performs as a mandatory step, so a failure here means the model would refuse
 * to run the skill anyway — better to surface it at install time.
 */
async function verifyAttribution(skillDir: string, signal?: AbortSignal): Promise<void> {
  const script = join(skillDir, 'scripts', 'attribution_guard.py')
  if (!(await pathExists(script))) {
    throw new Error('the package is missing scripts/attribution_guard.py')
  }
  for (const interpreter of ['python3', 'python']) {
    try {
      await runProcess(interpreter, ['scripts/attribution_guard.py'], {
        cwd: skillDir,
        timeoutMs: GUARD_TIMEOUT_MS,
        ...(signal ? { signal } : {})
      })
      return
    } catch (error) {
      // Only a missing interpreter is worth retrying under another name; a
      // real guard failure must surface as-is.
      if (error instanceof ProcessRunError && error.kind === 'spawn') continue
      throw error
    }
  }
  // No Python at all yet — the env service installs it next, and the skill
  // re-runs this guard on every activation, so this is not fatal to the install.
  logWarn('ppt-master', 'attribution guard skipped: no Python interpreter found')
}

async function readInstalledManifest(userDataDir: string): Promise<InstalledManifest | null> {
  try {
    const raw = await readFile(installedManifestPath(userDataDir), 'utf8')
    return InstalledManifestSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

async function writeInstalledManifest(
  userDataDir: string,
  manifest: InstalledManifest
): Promise<void> {
  const path = installedManifestPath(userDataDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/** Best-effort version from the package's SKILL.md frontmatter metadata. */
async function readLocalVersion(skillDir: string): Promise<string | undefined> {
  try {
    const text = await readFile(join(skillDir, 'SKILL.md'), 'utf8')
    return /^\s*version:\s*["']?([\w.+-]+)["']?\s*$/m.exec(text)?.[1]
  } catch {
    return undefined
  }
}

function hashKey(packageName: string, version: string): string {
  return createHash('sha256').update(`${packageName}@${version}`).digest('hex').slice(0, 24)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
