import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  crashKindSchema,
  crashRecordV1Schema,
  crashSeveritySchema,
  type CrashRecordV1
} from '../shared/crash-types'

export const CRASH_INDEX_FILE_NAME = 'crash-index.json'
export const CRASH_INDEX_MAX_RECORDS = 50

export const crashIndexEntryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(128),
    kind: crashKindSchema,
    severity: crashSeveritySchema,
    occurredAt: z.string().datetime({ offset: true }),
    file: z.string().min(1).max(512).regex(/^crash-[A-Za-z0-9_-]+\.json$/),
    message: z.string().max(2_048)
  })
  .strict()

const crashIndexSchema = z.array(crashIndexEntryV1Schema)

export type CrashIndexEntryV1 = z.infer<typeof crashIndexEntryV1Schema>

export interface CrashStore {
  writeFatal(record: CrashRecordV1): string
  enqueue(record: CrashRecordV1): Promise<string>
  readIndex(): Promise<CrashIndexEntryV1[]>
  reconcile(): Promise<void>
}

export interface CrashStoreOptions {
  directory: string
  maxRecords?: number
}

function crashFileName(record: CrashRecordV1): string {
  const timestamp = record.occurredAt.replace(/\D/g, '').slice(0, 17).padEnd(17, '0')
  return `crash-${timestamp}-${record.process.pid}-${record.id}.json`
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function toIndexEntry(record: CrashRecordV1, file: string): CrashIndexEntryV1 {
  return {
    schemaVersion: 1,
    id: record.id,
    kind: record.kind,
    severity: record.severity,
    occurredAt: record.occurredAt,
    file,
    message: record.error.message
  }
}

function sortAndLimit(
  entries: Iterable<CrashIndexEntryV1>,
  maxRecords: number
): CrashIndexEntryV1[] {
  return [...entries]
    .sort((left, right) => {
      const byTime = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
      return byTime === 0 ? left.id.localeCompare(right.id) : byTime
    })
    .slice(-maxRecords)
}

export function createCrashStore(options: CrashStoreOptions): CrashStore {
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? CRASH_INDEX_MAX_RECORDS))
  const indexPath = join(options.directory, CRASH_INDEX_FILE_NAME)
  let writeQueue: Promise<void> = Promise.resolve()

  const schedule = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation)
    writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  const readIndexFile = async (): Promise<CrashIndexEntryV1[]> => {
    try {
      const parsed = crashIndexSchema.safeParse(JSON.parse(await readFile(indexPath, 'utf8')))
      return parsed.success ? parsed.data : []
    } catch {
      return []
    }
  }

  const writeIndexFile = async (entries: CrashIndexEntryV1[]): Promise<void> => {
    await mkdir(options.directory, { recursive: true })
    const temporaryPath = `${indexPath}.tmp`
    await writeFile(temporaryPath, serialize(entries), 'utf8')
    await rename(temporaryPath, indexPath)
  }

  const writeRecord = async (record: CrashRecordV1): Promise<string> => {
    const validated = crashRecordV1Schema.parse(record)
    const file = crashFileName(validated)
    const targetPath = join(options.directory, file)
    const temporaryPath = `${targetPath}.tmp`
    await mkdir(options.directory, { recursive: true })
    await writeFile(temporaryPath, serialize(validated), 'utf8')
    await rename(temporaryPath, targetPath)
    return file
  }

  return {
    writeFatal(record) {
      const validated = crashRecordV1Schema.parse(record)
      const file = crashFileName(validated)
      const targetPath = join(options.directory, file)
      const temporaryPath = `${targetPath}.tmp`
      mkdirSync(options.directory, { recursive: true })
      writeFileSync(temporaryPath, serialize(validated), 'utf8')
      renameSync(temporaryPath, targetPath)
      return file
    },
    enqueue(record) {
      return schedule(async () => {
        const file = await writeRecord(record)
        const byId = new Map((await readIndexFile()).map((entry) => [entry.id, entry]))
        byId.set(record.id, toIndexEntry(record, file))
        await writeIndexFile(sortAndLimit(byId.values(), maxRecords))
        return file
      })
    },
    async readIndex() {
      await writeQueue
      return readIndexFile()
    },
    reconcile() {
      return schedule(async () => {
        let files: string[] = []
        try {
          files = await readdir(options.directory)
        } catch {
          await writeIndexFile([])
          return
        }

        const byId = new Map<string, CrashIndexEntryV1>()
        for (const file of files) {
          if (!/^crash-[A-Za-z0-9_-]+\.json$/.test(file)) continue
          try {
            const parsed = crashRecordV1Schema.safeParse(
              JSON.parse(await readFile(join(options.directory, file), 'utf8'))
            )
            if (!parsed.success) continue
            byId.set(parsed.data.id, toIndexEntry(parsed.data, file))
          } catch {
            // A malformed record is isolated from the rest of the crash history.
          }
        }
        await writeIndexFile(sortAndLimit(byId.values(), maxRecords))
      })
    }
  }
}
