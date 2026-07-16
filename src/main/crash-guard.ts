import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'electron'
import type { CrashRecordV1 } from '../shared/crash-types'
import { redactSecretText } from '../shared/secret-redaction'
import type { CreateCrashRecordInput } from './crash-context'

export interface LocalCrashReporterOptions {
  userDataPath: string
  setCrashDumpsPath: (path: string) => void
  startCrashReporter: (options: { uploadToServer: false; compress: false }) => void
  writeStderr?: (message: string) => void
}

export interface LocalCrashReporterResult {
  crashDirectory: string
  nativeDirectory: string
  pathConfigured: boolean
  reporterStarted: boolean
}

export interface RenderProcessGoneInput {
  reason: string
  exitCode: number
}

export interface ChildProcessGoneInput {
  type: string
  reason: string
  exitCode: number
  serviceName?: string
  name?: string
}

export interface MainCrashHandlers {
  uncaughtException(error: unknown): void
  unhandledRejection(reason: unknown): void
  renderProcessGone(details: RenderProcessGoneInput): void
  childProcessGone(details: ChildProcessGoneInput): void
}

export interface MainCrashHandlerDeps {
  createRecord: (input: CreateCrashRecordInput) => CrashRecordV1
  writeFatal: (record: CrashRecordV1) => string
  enqueue: (record: CrashRecordV1) => Promise<string | void>
  exit: (code: number) => void
  writeStderr: (message: string) => void
}

export interface MainCrashGuardInstallOptions {
  app: App
  processTarget?: NodeJS.Process
  handlers: MainCrashHandlers
}

function stderrLine(message: string): string {
  return `${redactSecretText(message).replace(/[\r\n]+/g, ' ').slice(0, 1_000)}\n`
}

function safeWriteStderr(write: (message: string) => void, message: string): void {
  try {
    write(stderrLine(message))
  } catch {
    // A diagnostic sink must never replace the original crash outcome.
  }
}

export function initializeLocalCrashReporter(
  options: LocalCrashReporterOptions
): LocalCrashReporterResult {
  const crashDirectory = join(options.userDataPath, 'logs', 'crash')
  const nativeDirectory = join(crashDirectory, 'native')
  const writeStderr = options.writeStderr ?? ((message: string): void => {
    process.stderr.write(message)
  })
  let pathConfigured = false
  let reporterStarted = false

  try {
    mkdirSync(nativeDirectory, { recursive: true })
    options.setCrashDumpsPath(nativeDirectory)
    pathConfigured = true
  } catch (error) {
    safeWriteStderr(
      writeStderr,
      `Failed to configure the local crash dump directory: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  try {
    options.startCrashReporter({ uploadToServer: false, compress: false })
    reporterStarted = true
  } catch (error) {
    safeWriteStderr(
      writeStderr,
      `Failed to start Electron crashReporter: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return {
    crashDirectory,
    nativeDirectory,
    pathConfigured,
    reporterStarted
  }
}

export function createMainCrashHandlers(deps: MainCrashHandlerDeps): MainCrashHandlers {
  let isHandlingFatalError = false

  const enqueueNonFatal = (input: CreateCrashRecordInput): void => {
    let record: CrashRecordV1
    try {
      record = deps.createRecord(input)
    } catch (error) {
      safeWriteStderr(
        deps.writeStderr,
        `Failed to create crash record: ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    try {
      void deps.enqueue(record).catch((error: unknown) => {
        safeWriteStderr(
          deps.writeStderr,
          `Failed to persist crash record: ${error instanceof Error ? error.message : String(error)}`
        )
      })
    } catch (error) {
      safeWriteStderr(
        deps.writeStderr,
        `Failed to queue crash record: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  return {
    uncaughtException(error) {
      if (isHandlingFatalError) {
        safeWriteStderr(deps.writeStderr, 'Recursive uncaught exception while handling a crash.')
        deps.exit(1)
        return
      }
      isHandlingFatalError = true
      try {
        const record = deps.createRecord({
          kind: 'uncaught-exception',
          severity: 'fatal',
          error
        })
        deps.writeFatal(record)
        safeWriteStderr(
          deps.writeStderr,
          `Fatal main-process error recorded (${record.id}): ${record.error.message}`
        )
      } catch (writeError) {
        safeWriteStderr(
          deps.writeStderr,
          `Failed to persist fatal crash record: ${
            writeError instanceof Error ? writeError.message : String(writeError)
          }`
        )
      }
      deps.exit(1)
    },
    unhandledRejection(reason) {
      enqueueNonFatal({
        kind: 'unhandled-rejection',
        severity: 'error',
        error: reason
      })
    },
    renderProcessGone(details) {
      if (details.reason === 'clean-exit') return
      enqueueNonFatal({
        kind: 'render-process-gone',
        severity: 'error',
        error: new Error(
          `Renderer process exited (${details.reason}, exit code ${details.exitCode}).`
        ),
        details: {
          reason: details.reason,
          exitCode: details.exitCode
        }
      })
    },
    childProcessGone(details) {
      if (details.reason === 'clean-exit') return
      enqueueNonFatal({
        kind: 'child-process-gone',
        severity: 'error',
        error: new Error(
          `${details.type} child process exited (${details.reason}, exit code ${details.exitCode}).`
        ),
        details: {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          ...(details.serviceName ? { serviceName: details.serviceName } : {}),
          ...(details.name ? { name: details.name } : {})
        }
      })
    }
  }
}

export function installMainCrashGuard(options: MainCrashGuardInstallOptions): () => void {
  const processTarget = options.processTarget ?? process
  const onUncaughtException = (error: Error): void => {
    options.handlers.uncaughtException(error)
  }
  const onUnhandledRejection = (reason: unknown): void => {
    options.handlers.unhandledRejection(reason)
  }
  const onRenderProcessGone = (
    _event: Electron.Event,
    _webContents: Electron.WebContents,
    details: Electron.RenderProcessGoneDetails
  ): void => {
    options.handlers.renderProcessGone({
      reason: details.reason,
      exitCode: details.exitCode
    })
  }
  const onChildProcessGone = (
    _event: Electron.Event,
    details: Electron.Details
  ): void => {
    options.handlers.childProcessGone({
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName ? { serviceName: details.serviceName } : {}),
      ...(details.name ? { name: details.name } : {})
    })
  }

  processTarget.on('uncaughtException', onUncaughtException)
  processTarget.on('unhandledRejection', onUnhandledRejection)
  options.app.on('render-process-gone', onRenderProcessGone)
  options.app.on('child-process-gone', onChildProcessGone)

  let isDisposed = false
  return (): void => {
    if (isDisposed) return
    isDisposed = true
    processTarget.removeListener('uncaughtException', onUncaughtException)
    processTarget.removeListener('unhandledRejection', onUnhandledRejection)
    options.app.removeListener('render-process-gone', onRenderProcessGone)
    options.app.removeListener('child-process-gone', onChildProcessGone)
  }
}
