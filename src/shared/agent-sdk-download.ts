import { z } from 'zod'

export const AgentSdkDownloadStatusSchema = z.enum([
  'idle',
  'resolving',
  'downloading',
  'retrying',
  'verifying',
  'installing',
  'ready',
  'failed',
  'interrupted'
])
export type AgentSdkDownloadStatus = z.infer<typeof AgentSdkDownloadStatusSchema>

export const AgentSdkDownloadErrorCodeSchema = z.enum([
  'unsupported',
  'metadata_invalid',
  'network',
  'timeout_connect',
  'timeout_stall',
  'http_status',
  'range_invalid',
  'size_limit',
  'checksum_mismatch',
  'disk_full',
  'permission',
  'extract_failed',
  'binary_invalid',
  'state_corrupt'
])
export type AgentSdkDownloadErrorCode = z.infer<typeof AgentSdkDownloadErrorCodeSchema>

export const AgentSdkDownloadErrorSchema = z
  .object({
    code: AgentSdkDownloadErrorCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    retriable: z.boolean()
  })
  .strict()
export type AgentSdkDownloadError = z.infer<typeof AgentSdkDownloadErrorSchema>

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/)
const SriSha512Schema = z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/)
const IsoTimestampSchema = z.string().datetime({ offset: true })

export const AgentSdkDownloadStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: AgentSdkDownloadStatusSchema,
    packageName: z.string().trim().min(1).max(200),
    sdkVersion: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(32),
    arch: z.string().trim().min(1).max(32),
    attempt: z.number().int().nonnegative().max(100),
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative().nullable(),
    integrity: SriSha512Schema.optional(),
    tarballFingerprint: Sha256HexSchema.optional(),
    etag: z.string().trim().min(1).max(512).optional(),
    lastModified: z.string().trim().min(1).max(512).optional(),
    nextRetryAt: IsoTimestampSchema.optional(),
    error: AgentSdkDownloadErrorSchema.optional(),
    updatedAt: IsoTimestampSchema
  })
  .strict()
export type AgentSdkDownloadState = z.infer<typeof AgentSdkDownloadStateSchema>

const RelativeBinaryPathSchema = z.string().trim().min(1).max(1_024).refine((value) => {
  if (value.startsWith('/') || value.startsWith('\\')) return false
  const segments = value.replaceAll('\\', '/').split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}, 'binary path must stay relative to the agent SDK root')

export const AgentSdkInstalledManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageName: z.string().trim().min(1).max(200),
    sdkVersion: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(32),
    arch: z.string().trim().min(1).max(32),
    relativePath: RelativeBinaryPathSchema,
    binarySize: z.number().int().positive(),
    binarySha256: Sha256HexSchema,
    // Absent when the manifest records a migrated legacy binary, whose source
    // tarball is unknown.
    tarballIntegrity: SriSha512Schema.optional(),
    installedAt: IsoTimestampSchema
  })
  .strict()
export type AgentSdkInstalledManifest = z.infer<typeof AgentSdkInstalledManifestSchema>
