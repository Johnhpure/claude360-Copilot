import { z } from 'zod'

export const CRASH_ERROR_MESSAGE_MAX_LENGTH = 2_048
export const CRASH_ERROR_STACK_MAX_LENGTH = 8_192
export const CRASH_RECENT_IPC_MAX_RECORDS = 20
// Kept in the zod-free crash-channel module so the sandboxed preload can
// import it without dragging zod into the preload bundle.
export { CRASH_CONTEXT_UPDATE_CHANNEL } from './crash-channel'

const MAX_ID_LENGTH = 256
const MAX_PATH_LENGTH = 4_096
const MAX_ROUTE_LENGTH = 2_048
const MAX_SHORT_TEXT_LENGTH = 256

export const crashKindSchema = z.enum([
  'uncaught-exception',
  'unhandled-rejection',
  'render-process-gone',
  'child-process-gone',
  'renderer-error'
])

export const crashSeveritySchema = z.enum(['fatal', 'error'])

export const rendererCrashEventPayloadSchema = z
  .object({
    kind: z.enum(['error', 'unhandledrejection']),
    name: z.string().min(1).max(256),
    message: z.string().max(CRASH_ERROR_MESSAGE_MAX_LENGTH),
    stack: z.string().max(CRASH_ERROR_STACK_MAX_LENGTH).optional(),
    signature: z.string().min(1).max(64),
    source: z.string().max(2_048).optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional()
  })
  .strict()

export const rendererCrashContextPayloadSchema = z
  .object({
    route: z.string().trim().max(MAX_ROUTE_LENGTH).nullable().optional(),
    workspaceRoot: z.string().trim().max(MAX_PATH_LENGTH).nullable().optional(),
    activeThreadId: z.string().trim().max(MAX_ID_LENGTH).nullable().optional(),
    currentTurnId: z.string().trim().max(MAX_ID_LENGTH).nullable().optional(),
    busy: z.boolean().optional(),
    task: z
      .object({
        id: z.string().trim().min(1).max(MAX_ID_LENGTH),
        status: z.string().trim().min(1).max(64)
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict()

export const normalizedRendererCrashContextSchema = z
  .object({
    route: z.string().max(MAX_ROUTE_LENGTH).optional(),
    workspace: z
      .object({
        basename: z.string().min(1).max(MAX_SHORT_TEXT_LENGTH),
        hash: z.string().regex(/^[a-f0-9]{64}$/)
      })
      .strict()
      .optional(),
    threadId: z.string().max(MAX_ID_LENGTH).optional(),
    turnId: z.string().max(MAX_ID_LENGTH).optional(),
    busy: z.boolean().optional(),
    task: z
      .object({
        id: z.string().min(1).max(MAX_ID_LENGTH),
        status: z.string().min(1).max(64)
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict()

export const recentIpcOperationSchema = z
  .object({
    channel: z.string().min(1).max(256),
    at: z.string().datetime({ offset: true }),
    durationMs: z.number().finite().nonnegative().optional(),
    failed: z.boolean().optional()
  })
  .strict()

export const crashStartupPhasesSchema = z.record(
  z.string().min(1).max(128),
  z.number().finite().nonnegative()
)

export const crashContextSnapshotSchema = z
  .object({
    startupPhases: crashStartupPhasesSchema,
    runtime: z.unknown().nullable(),
    renderer: normalizedRendererCrashContextSchema.nullable(),
    recentIpc: z.array(recentIpcOperationSchema).max(CRASH_RECENT_IPC_MAX_RECORDS),
    details: z.record(z.string().min(1).max(128), z.unknown()).optional()
  })
  .strict()

export const crashRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    kind: crashKindSchema,
    severity: crashSeveritySchema,
    occurredAt: z.string().datetime({ offset: true }),
    process: z
      .object({
        pid: z.number().int().nonnegative(),
        type: z.string().min(1).max(64),
        uptimeMs: z.number().finite().nonnegative()
      })
      .strict(),
    versions: z
      .object({
        app: z.string().max(128),
        electron: z.string().max(128),
        node: z.string().max(128),
        chrome: z.string().max(128).optional()
      })
      .strict(),
    system: z
      .object({
        platform: z.string().min(1).max(64),
        arch: z.string().min(1).max(64),
        packaged: z.boolean()
      })
      .strict(),
    memory: z
      .object({
        rss: z.number().finite().nonnegative(),
        heapUsed: z.number().finite().nonnegative(),
        heapTotal: z.number().finite().nonnegative(),
        external: z.number().finite().nonnegative(),
        systemTotalKb: z.number().finite().nonnegative().optional(),
        systemFreeKb: z.number().finite().nonnegative().optional(),
        appMetrics: z
          .array(
            z
              .object({
                type: z.string().min(1).max(64),
                pid: z.number().int().nonnegative(),
                workingSetSizeKb: z.number().finite().nonnegative().optional()
              })
              .strict()
          )
          .max(64)
          .optional()
      })
      .strict(),
    error: z
      .object({
        name: z.string().min(1).max(256),
        message: z.string().max(CRASH_ERROR_MESSAGE_MAX_LENGTH),
        stack: z.string().max(CRASH_ERROR_STACK_MAX_LENGTH).optional()
      })
      .strict(),
    context: crashContextSnapshotSchema
  })
  .strict()

export type CrashKind = z.infer<typeof crashKindSchema>
export type CrashSeverity = z.infer<typeof crashSeveritySchema>
export type RendererCrashEventPayload = z.infer<typeof rendererCrashEventPayloadSchema>
export type RendererCrashContextPayload = z.infer<typeof rendererCrashContextPayloadSchema>
export type NormalizedRendererCrashContext = z.infer<
  typeof normalizedRendererCrashContextSchema
>
export type RecentIpcOperation = z.infer<typeof recentIpcOperationSchema>
export type CrashContextSnapshot = z.infer<typeof crashContextSnapshotSchema>
export type CrashRecordV1 = z.infer<typeof crashRecordV1Schema>
