/**
 * Managed Python environment for the PPT Master skill.
 *
 * The skill's ~90 scripts need 19 packages, several of which (skia-pathops,
 * uharfbuzz, PyMuPDF) ship binary wheels. Rather than mutating the user's
 * system Python, the app creates a dedicated venv under userData and prepends
 * it to PATH when spawning the Kun runtime — so `python3 scripts/foo.py` inside
 * the agent's bash tool resolves to this interpreter with no change to the
 * tool layer itself.
 */
import { mkdir, stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { SHELL_PATH_PREFIX_ENV } from '../../../kun/src/adapters/tool/builtin-tool-utils.js'
import {
  PPT_MASTER_PROBE_MODULES,
  type PptMasterPythonState
} from '../../shared/ppt-master'
import { logInfo, logWarn } from '../logger'
import { ProcessRunError, errorText, runProcess } from './ppt-master-process'
import { pptMasterRootDir } from './ppt-master-installer'

const VERSION_TIMEOUT_MS = 15_000
const VENV_CREATE_TIMEOUT_MS = 3 * 60_000
const PIP_INSTALL_TIMEOUT_MS = 30 * 60_000
const PROBE_TIMEOUT_MS = 60_000
const MIN_PYTHON_MINOR = 9

export function pptMasterVenvDir(userDataDir: string): string {
  return join(pptMasterRootDir(userDataDir), 'venv')
}

export function pptMasterVenvBinDir(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(pptMasterVenvDir(userDataDir), platform === 'win32' ? 'Scripts' : 'bin')
}

export function pptMasterVenvInterpreter(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(pptMasterVenvBinDir(userDataDir, platform), platform === 'win32' ? 'python.exe' : 'python3')
}

/**
 * Prepend the managed venv to PATH. Applied to the Kun runtime's spawn env so
 * every `python3` the agent runs inside the skill hits the managed interpreter.
 * Returns the env unchanged when the venv is absent.
 */
export function withPptMasterPython(
  env: NodeJS.ProcessEnv,
  userDataDir: string,
  options: { platform?: NodeJS.Platform; exists?: boolean } = {}
): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform
  if (options.exists === false) return env
  const binDir = pptMasterVenvBinDir(userDataDir, platform)
  // PATH casing varies on Windows (PATH vs Path); update the key as it exists.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const current = env[pathKey] ?? ''
  const alreadyFirst = current.split(delimiter)[0] === binDir
  if (alreadyFirst) return env
  return {
    ...env,
    [pathKey]: current ? `${binDir}${delimiter}${current}` : binDir,
    // Prepending PATH here is not enough on its own: Kun runs bash as a *login*
    // shell (`-lc`), and macOS login shells run `path_helper`, which rebuilds
    // PATH with the system directories first — demoting this entry below
    // /usr/local/bin, so the skill's `python3 scripts/foo.py` would hit the
    // system interpreter with none of these packages. Kun re-applies this
    // prefix after shell startup, where nothing reorders it again.
    [SHELL_PATH_PREFIX_ENV]: binDir,
    // Some skill scripts shell out to `python` rather than `python3`; give both
    // a deterministic target without relying on PATH ordering alone.
    PPT_MASTER_PYTHON: pptMasterVenvInterpreter(userDataDir, platform)
  }
}

export type PythonEnvOptions = {
  userDataDir: string
  platform?: NodeJS.Platform
  signal?: AbortSignal
  onProgress?: (line: string) => void
}

/** Current state of the managed venv, including an import probe. */
export async function pptMasterPythonState(
  options: PythonEnvOptions
): Promise<PptMasterPythonState> {
  const platform = options.platform ?? process.platform
  const interpreter = pptMasterVenvInterpreter(options.userDataDir, platform)
  if (!(await pathExists(interpreter))) {
    return { status: 'missing', message: 'the managed Python environment has not been created yet' }
  }
  try {
    const version = await interpreterVersion(interpreter, options.signal)
    const missingModules = await probeModules(interpreter, options.signal)
    if (missingModules.length > 0) {
      return {
        status: 'missing',
        interpreter,
        version,
        missingModules,
        message: `${missingModules.length} of ${PPT_MASTER_PROBE_MODULES.length} required packages are missing`
      }
    }
    return { status: 'ready', interpreter, version }
  } catch (error) {
    return { status: 'error', interpreter, message: errorText(error) }
  }
}

/**
 * Create the venv (if needed) and install the skill's requirements into it.
 * `requirementsPath` comes from the installed skill package, so the skill must
 * be provisioned first.
 */
export async function installPptMasterPython(
  options: PythonEnvOptions & { requirementsPath: string }
): Promise<PptMasterPythonState> {
  const platform = options.platform ?? process.platform
  const interpreter = pptMasterVenvInterpreter(options.userDataDir, platform)
  const report = (line: string): void => options.onProgress?.(line)

  try {
    if (!(await pathExists(options.requirementsPath))) {
      return {
        status: 'error',
        message: `requirements.txt not found at ${options.requirementsPath}; install the skill first`
      }
    }

    if (!(await pathExists(interpreter))) {
      const base = await findSystemPython(platform, options.signal)
      if (!base.ok) return { status: 'error', message: base.message }
      report(`Creating virtual environment with ${base.command} (${base.version})`)
      await mkdir(pptMasterRootDir(options.userDataDir), { recursive: true })
      await runProcess(base.command, ['-m', 'venv', pptMasterVenvDir(options.userDataDir)], {
        timeoutMs: VENV_CREATE_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
        onLine: report
      })
      if (!(await pathExists(interpreter))) {
        return {
          status: 'error',
          message: 'the virtual environment was created but has no interpreter; ' +
            'on Debian/Ubuntu this usually means the python3-venv package is missing'
        }
      }
    }

    report('Upgrading pip')
    await runProcess(interpreter, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
      timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      onLine: report
    }).catch((error) => {
      // A stale pip still installs the requirements; do not fail the whole run.
      logWarn('ppt-master', 'pip upgrade failed', errorText(error))
    })

    report('Installing skill requirements (this can take several minutes)')
    // `--prefer-binary` is load-bearing, not an optimisation. Without it pip
    // backtracks through older releases when a wheel does not match the host
    // tag, and lands on an sdist whose build needs a toolchain the user does
    // not have — observed on macOS with a universal2 CPython, where the
    // resolver reached a `cryptography` sdist and failed demanding Rust/Cargo.
    // Preferring wheels keeps the resolution on binary releases while still
    // allowing an sdist where that is the only option (some pure-Python deps).
    await runProcess(interpreter, [
      '-m', 'pip', 'install', '--prefer-binary', '-r', options.requirementsPath
    ], {
      timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      onLine: report
    })

    const state = await pptMasterPythonState({ ...options, platform })
    if (state.status === 'ready') logInfo('ppt-master', `python environment ready: ${state.version ?? ''}`)
    return state
  } catch (error) {
    const message = errorText(error)
    logWarn('ppt-master', 'python environment install failed', message)
    return { status: 'error', message }
  }
}

type SystemPython =
  | { ok: true; command: string; version: string }
  | { ok: false; message: string }

/**
 * Find a system interpreter new enough to build the venv. Tries the usual
 * command names in order; Windows additionally exposes the `py` launcher.
 */
export async function findSystemPython(
  platform: NodeJS.Platform = process.platform,
  signal?: AbortSignal
): Promise<SystemPython> {
  const candidates = platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']
  let lastMessage = ''
  for (const command of candidates) {
    try {
      const version = await interpreterVersion(command, signal)
      if (!isSupportedVersion(version)) {
        lastMessage = `${command} reports ${version}, but Python 3.${MIN_PYTHON_MINOR}+ is required`
        continue
      }
      return { ok: true, command, version }
    } catch (error) {
      if (!(error instanceof ProcessRunError && error.kind === 'spawn')) {
        lastMessage = errorText(error)
      }
    }
  }
  return {
    ok: false,
    message: lastMessage || installHint(platform)
  }
}

function installHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return 'No Python 3 was found. Install it with `brew install python@3.12` or from python.org, then retry.'
  }
  if (platform === 'win32') {
    return 'No Python 3 was found. Install it from python.org (tick "Add python.exe to PATH"), then retry.'
  }
  return 'No Python 3 was found. Install your distribution\'s python3 and python3-venv packages, then retry.'
}

export function isSupportedVersion(version: string): boolean {
  const match = /(\d+)\.(\d+)/.exec(version)
  if (!match) return false
  const major = Number.parseInt(match[1] ?? '', 10)
  const minor = Number.parseInt(match[2] ?? '', 10)
  if (major !== 3) return major > 3
  return minor >= MIN_PYTHON_MINOR
}

async function interpreterVersion(command: string, signal?: AbortSignal): Promise<string> {
  const { stdout, stderr } = await runProcess(command, ['--version'], {
    timeoutMs: VERSION_TIMEOUT_MS,
    ...(signal ? { signal } : {})
  })
  // Python <3.4 wrote --version to stderr; harmless to keep the fallback.
  return (stdout.trim() || stderr.trim()).replace(/^Python\s+/i, '')
}

/**
 * Marker prefixing the probe's own result line.
 *
 * Importing a module is allowed to print, and some of these do: PyMuPDF writes
 * its `fitz` deprecation notice to *stdout* (not just stderr). Parsing the whole
 * stdout would count that sentence as a missing module name, so the result line
 * is tagged and everything else on the stream is ignored.
 */
const PROBE_MARKER = '__ppt_master_probe__:'

/**
 * Import each probe module in one interpreter run and report the failures.
 * Import (not `pip show`) is the check that matters: a binary wheel can be
 * installed yet fail to load against the host's libraries.
 */
export async function probeModules(interpreter: string, signal?: AbortSignal): Promise<string[]> {
  const script = [
    'import importlib',
    `mods = ${JSON.stringify([...PPT_MASTER_PROBE_MODULES])}`,
    'missing = []',
    'for name in mods:',
    '    try:',
    '        importlib.import_module(name)',
    '    except Exception:',
    '        missing.append(name)',
    `print("${PROBE_MARKER}" + ",".join(missing))`
  ].join('\n')
  try {
    const { stdout } = await runProcess(interpreter, ['-c', script], {
      timeoutMs: PROBE_TIMEOUT_MS,
      ...(signal ? { signal } : {})
    })
    return parseProbeOutput(stdout)
  } catch {
    // The interpreter itself is unusable; treat every module as missing.
    return [...PPT_MASTER_PROBE_MODULES]
  }
}

/**
 * Read the marked result line out of the probe's stdout. A missing marker means
 * the script never reached its final print, so nothing can be trusted as loaded.
 */
export function parseProbeOutput(stdout: string): string[] {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .reverse()
    .find((entry) => entry.startsWith(PROBE_MARKER))
  if (line === undefined) return [...PPT_MASTER_PROBE_MODULES]
  return line
    .slice(PROBE_MARKER.length)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
