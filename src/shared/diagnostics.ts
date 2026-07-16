import { z } from 'zod'

export const diagnosticsExportResultSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      path: z.string().min(1).max(4_096)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      canceled: z.literal(true)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      canceled: z.literal(false).optional(),
      message: z.string().min(1).max(2_000)
    })
    .strict()
])

export type DiagnosticsExportResult = z.infer<typeof diagnosticsExportResultSchema>
