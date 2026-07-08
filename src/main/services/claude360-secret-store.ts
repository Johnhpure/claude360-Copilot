import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Claude360 敏感凭据本地加密存储（plan-02 Task 2）。
 *
 * 设计：
 * - cli_token / API Key 明文只在 main 进程用应用自管理 AES-GCM 加密后落盘，
 *   绝不进入 settings、不下发 renderer、日志不输出明文。
 * - 不调用 Electron safeStorage / keytar / macOS Keychain；旧 safeStorage 记录不读取、
 *   不迁移，用户重新登录后写入新的本地存储。
 * - ref 使用稳定前缀：`claude360:cli-token`、`claude360:api-key:<tokenId>`。
 */

export const CLAUDE360_SECRET_REF_PREFIX = 'claude360:'
export const CLAUDE360_CLI_TOKEN_REF = 'claude360:cli-token'

export function claude360ApiKeyRef(tokenId: number | string): string {
  return `claude360:api-key:${tokenId}`
}

export type SecretFileSystem = {
  existsSync(path: string): boolean
  readFileSync(path: string): string
  writeFileSync(path: string, data: string): void
  chmodSync?(path: string, mode: number): void
}

export type Claude360SecretStore = {
  saveSecret(ref: string, value: string): Promise<void>
  loadSecret(ref: string): Promise<string | null>
  deleteSecret(ref: string): Promise<void>
  clearClaude360Secrets(): Promise<void>
  /** 当前是否使用应用自管理本地加密。 */
  isEncryptionActive(): boolean
}

export type Claude360SecretStoreDeps = {
  /** 加密落盘文件的绝对路径（如 userData/secure-store.json）。 */
  filePath: string
  /** 本地 AES secret 文件路径；默认与 filePath 同名、扩展为 .key。 */
  keyPath?: string
  /** 注入文件系统，便于测试。默认使用 node fs。 */
  fileSystem?: SecretFileSystem
}

type LocalAesStoredRecord = {
  scheme: 'aes-256-gcm-local'
  iv: string
  tag: string
  data: string
}

type SecretFileShape = Record<string, LocalAesStoredRecord | unknown>

const LOCAL_AES_SCHEME = 'aes-256-gcm-local'
const LOCAL_AES_KEY_BYTES = 32
const LOCAL_AES_IV_BYTES = 12
const FILE_MODE_OWNER_READ_WRITE = 0o600

const defaultFileSystem: SecretFileSystem = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path) => readFileSync(path, 'utf8'),
  writeFileSync: (path, data) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data, 'utf8')
  },
  chmodSync: (path, mode) => chmodSync(path, mode)
}

export function createClaude360SecretStore(deps: Claude360SecretStoreDeps): Claude360SecretStore {
  const fs = deps.fileSystem ?? defaultFileSystem
  const keyPath = deps.keyPath ?? deps.filePath.replace(/\.json$/u, '.key')

  function isLocalAesRecord(value: unknown): value is LocalAesStoredRecord {
    if (!value || typeof value !== 'object') return false
    const record = value as Partial<LocalAesStoredRecord>
    return (
      record.scheme === LOCAL_AES_SCHEME &&
      typeof record.iv === 'string' &&
      typeof record.tag === 'string' &&
      typeof record.data === 'string'
    )
  }

  function readAll(): SecretFileShape {
    if (!fs.existsSync(deps.filePath)) return {}
    try {
      const parsed = JSON.parse(fs.readFileSync(deps.filePath)) as unknown
      if (typeof parsed !== 'object' || parsed === null) return {}
      return parsed as SecretFileShape
    } catch {
      // 文件损坏时不抛错，视作空（避免泄露内容到日志）。
      return {}
    }
  }

  function writeAll(records: SecretFileShape): void {
    fs.writeFileSync(deps.filePath, JSON.stringify(records))
    fs.chmodSync?.(deps.filePath, FILE_MODE_OWNER_READ_WRITE)
  }

  function readKey(): Buffer | null {
    if (!fs.existsSync(keyPath)) return null
    try {
      const key = Buffer.from(fs.readFileSync(keyPath), 'base64')
      return key.byteLength === LOCAL_AES_KEY_BYTES ? key : null
    } catch {
      return null
    }
  }

  function getOrCreateKey(): Buffer {
    const existing = readKey()
    if (existing) return existing
    const key = randomBytes(LOCAL_AES_KEY_BYTES)
    fs.writeFileSync(keyPath, key.toString('base64'))
    fs.chmodSync?.(keyPath, FILE_MODE_OWNER_READ_WRITE)
    return key
  }

  function encryptSecret(value: string): LocalAesStoredRecord {
    const key = getOrCreateKey()
    const iv = randomBytes(LOCAL_AES_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return {
      scheme: LOCAL_AES_SCHEME,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    }
  }

  function decryptSecret(record: LocalAesStoredRecord): string | null {
    const key = readKey()
    if (!key) return null
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(record.data, 'base64')),
        decipher.final()
      ]).toString('utf8')
    } catch {
      return null
    }
  }

  return {
    isEncryptionActive: () => true,

    async saveSecret(ref: string, value: string): Promise<void> {
      const records = readAll()
      records[ref] = encryptSecret(value)
      writeAll(records)
    },

    async loadSecret(ref: string): Promise<string | null> {
      const record = readAll()[ref]
      if (!isLocalAesRecord(record)) return null
      return decryptSecret(record)
    },

    async deleteSecret(ref: string): Promise<void> {
      const records = readAll()
      if (ref in records) {
        delete records[ref]
        writeAll(records)
      }
    },

    async clearClaude360Secrets(): Promise<void> {
      const records = readAll()
      let changed = false
      for (const key of Object.keys(records)) {
        if (key.startsWith(CLAUDE360_SECRET_REF_PREFIX)) {
          delete records[key]
          changed = true
        }
      }
      if (changed) writeAll(records)
    }
  }
}
