/**
 * Shared contract for the PPT Master skill integration.
 *
 * PPT Master is an external Claude Code Skill (~13k files of Python scripts,
 * workflow docs, icon and template libraries) that turns source material into
 * natively editable PPTX. The app ships it as a bundled resource so the PPT
 * assistant works offline and on first launch, and manages a dedicated Python
 * virtualenv for its scripts.
 *
 * Resolution order — first hit wins:
 *   1. `PPT_MASTER_SKILL_DIR`   developer override pointing at a checkout
 *   2. bundled resources        shipped with the app (the normal case)
 *   3. downloaded npm package   fallback for builds that omit the bundle
 */

/** npm package that carries the skill payload, used only by the download fallback. */
export const PPT_MASTER_PACKAGE = '@claude360/ppt-master-skill'

/** Skill version this app release is verified against. */
export const PPT_MASTER_VERSION = '4.8.0'

/**
 * Directory name of the skill package inside the installed root. The installed
 * root is what gets handed to the Kun skill runtime as a scan root; the runtime
 * then discovers this child directory as the actual skill package.
 */
export const PPT_MASTER_SKILL_DIR_NAME = 'ppt-master'

/** Skill id after slugging `name: ppt-master` from its SKILL.md frontmatter. */
export const PPT_MASTER_SKILL_ID = 'ppt-master'

/**
 * Points the app at an unpacked skill directory on disk instead of downloading
 * from npm. Set it to a checkout's `skills/ppt-master` parent directory to
 * develop or verify against a local copy before the package is published.
 */
export const PPT_MASTER_LOCAL_DIR_ENV = 'PPT_MASTER_SKILL_DIR'

/** Overrides the npm package name, for private mirrors or forks. */
export const PPT_MASTER_PACKAGE_ENV = 'PPT_MASTER_SKILL_PACKAGE'

/** Overrides where the bundled copy is looked for; mainly a test seam. */
export const PPT_MASTER_BUNDLED_DIR_ENV = 'PPT_MASTER_BUNDLED_DIR'

/**
 * Directory holding the bundled skill package, both in the repo
 * (`packages/<name>/ppt-master`) and in a packaged app
 * (`<resources>/<name>/ppt-master`). It is the scan root handed to Kun; the
 * `ppt-master` child inside it is the skill package.
 */
export const PPT_MASTER_BUNDLE_DIR_NAME = 'ppt-master-skill'

/** Python packages probed to decide whether the venv is actually usable. */
export const PPT_MASTER_PROBE_MODULES = [
  'pptx',
  'fitz',
  'pathops',
  'uharfbuzz',
  'PIL',
  'yaml',
  'requests'
] as const

export type PptMasterSkillStatus =
  | 'missing'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'ready'
  | 'error'

export type PptMasterSkillState = {
  status: PptMasterSkillStatus
  /** Installed version, present once a manifest exists. */
  version?: string
  /** Scan root handed to the Kun skill runtime. */
  root?: string
  /** Directory of the skill package itself (the one holding SKILL.md). */
  skillDir?: string
  /** True when the source is a directory already on disk rather than a download. */
  local?: boolean
  /** Which of the three resolution channels supplied this copy. */
  source?: 'local' | 'bundled' | 'download'
  receivedBytes?: number
  totalBytes?: number | null
  message?: string
}

export type PptMasterPythonStatus = 'missing' | 'installing' | 'ready' | 'error'

export type PptMasterPythonState = {
  status: PptMasterPythonStatus
  /** Interpreter inside the managed venv, once it exists. */
  interpreter?: string
  /** Version string of the interpreter the venv was created from. */
  version?: string
  /** Probe modules that failed to import. */
  missingModules?: string[]
  /** Latest pip/venv line, surfaced as install progress. */
  progress?: string
  message?: string
}

export type PptMasterState = {
  skill: PptMasterSkillState
  python: PptMasterPythonState
}

export type PptMasterActionResult =
  | { ok: true; state: PptMasterState }
  | { ok: false; message: string; state: PptMasterState }

export function pptMasterIsReady(state: PptMasterState): boolean {
  return state.skill.status === 'ready' && state.python.status === 'ready'
}
