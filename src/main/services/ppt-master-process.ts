import { spawn } from 'node:child_process'

/**
 * Small spawn helper shared by the PPT Master installer and Python env service.
 * Mirrors the bounded-output/timeout discipline of the Agent SDK installer's
 * private runner, kept local so provisioning a skill never reaches into the
 * model-runtime install path.
 */

const DEFAULT_OUTPUT_LIMIT = 256 * 1024

export class ProcessRunError extends Error {
  readonly kind: 'exit' | 'timeout' | 'spawn'
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string

  constructor(input: {
    kind: 'exit' | 'timeout' | 'spawn'
    message: string
    exitCode?: number | null
    stdout?: string
    stderr?: string
    cause?: unknown
  }) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined)
    this.name = 'ProcessRunError'
    this.kind = input.kind
    this.exitCode = input.exitCode ?? null
    this.stdout = input.stdout ?? ''
    this.stderr = input.stderr ?? ''
  }
}

export type RunProcessOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Called for each complete stdout/stderr line, for install progress. */
  onLine?: (line: string) => void
}

export type RunProcessResult = { stdout: string; stderr: string }

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions
): Promise<RunProcessResult> {
  const limit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT
  return new Promise<RunProcessResult>((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      rejectPromise(new ProcessRunError({
        kind: 'spawn',
        message: `failed to start ${command}: ${errorText(error)}`,
        cause: error
      }))
      return
    }

    let stdout = ''
    let stderr = ''
    let pendingLine = ''
    let settled = false
    const timer = setTimeout(() => {
      finish(new ProcessRunError({
        kind: 'timeout',
        message: `${command} timed out after ${options.timeoutMs}ms`,
        stdout,
        stderr
      }))
      child.kill('SIGKILL')
    }, options.timeoutMs)

    const onAbort = (): void => {
      finish(new ProcessRunError({ kind: 'timeout', message: `${command} was cancelled`, stdout, stderr }))
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (error: ProcessRunError | null, result?: RunProcessResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) rejectPromise(error)
      else resolvePromise(result ?? { stdout, stderr })
    }

    const emitLines = (chunk: string): void => {
      if (!options.onLine) return
      pendingLine += chunk
      const lines = pendingLine.split(/\r?\n/)
      pendingLine = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) options.onLine(trimmed)
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (stdout.length < limit) stdout += text
      emitLines(text)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (stderr.length < limit) stderr += text
      emitLines(text)
    })
    child.on('error', (error) => {
      finish(new ProcessRunError({
        kind: 'spawn',
        message: `failed to run ${command}: ${errorText(error)}`,
        stdout,
        stderr,
        cause: error
      }))
    })
    child.on('close', (code) => {
      if (pendingLine.trim() && options.onLine) options.onLine(pendingLine.trim())
      if (code === 0) {
        finish(null, { stdout, stderr })
        return
      }
      finish(new ProcessRunError({
        kind: 'exit',
        message: `${command} exited with code ${code ?? 'null'}`,
        exitCode: code,
        stdout,
        stderr
      }))
    })
  })
}

export function errorText(error: unknown): string {
  if (error instanceof ProcessRunError) {
    const detail = error.stderr.trim() || error.stdout.trim()
    return detail ? `${error.message}: ${truncate(detail, 600)}` : error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}
