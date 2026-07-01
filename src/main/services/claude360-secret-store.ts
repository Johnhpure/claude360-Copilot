import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Claude360 敏感凭据加密存储（plan-02 Task 2）。
 *
 * 设计：
 * - cli_token / API Key 明文只在 main 进程经 Electron `safeStorage` 加密后落盘，
 *   绝不进入 settings、不下发 renderer、日志不输出明文。
 * - `safeStorage` 在某些 Linux 环境不可用时，使用**显式、集中**的降级方案
 *   （base64 混淆 + `enc:false` 标记），后续可替换为系统 keychain / keytar。
 * - ref 使用稳定前缀：`claude360:cli-token`、`claude360:api-key:<tokenId>`。
 */

export const CLAUDE360_SECRET_REF_PREFIX = 'claude360:'
export const CLAUDE360_CLI_TOKEN_REF = 'claude360:cli-token'

export function claude360ApiKeyRef(tokenId: number | string): string {
  return `claude360:api-key:${tokenId}`
}

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type SecretFileSystem = {
  existsSync(path: string): boolean
  readFileSync(path: string): string
  writeFileSync(path: string, data: string): void
}

export type Claude360SecretStore = {
  saveSecret(ref: string, value: string): Promise<void>
  loadSecret(ref: string): Promise<string | null>
  deleteSecret(ref: string): Promise<void>
  clearClaude360Secrets(): Promise<void>
  /** 当前是否使用真正的系统加密（false 表示走降级混淆，需提示用户）。 */
  isEncryptionActive(): boolean
}

export type Claude360SecretStoreDeps = {
  /** 加密落盘文件的绝对路径（如 userData/claude360-secrets.json）。 */
  filePath: string
  /** 注入 Electron safeStorage；省略或不可用时走降级方案。 */
  safeStorage?: SafeStorageLike
  /** 注入文件系统，便于测试。默认使用 node fs。 */
  fileSystem?: SecretFileSystem
}

type StoredRecord = {
  /** true = safeStorage 加密；false = 降级 base64 混淆。 */
  enc: boolean
  /** base64 编码的密文或混淆数据。 */
  data: string
}

type SecretFileShape = Record<string, StoredRecord>

const defaultFileSystem: SecretFileSystem = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path) => readFileSync(path, 'utf8'),
  writeFileSync: (path, data) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data, 'utf8')
  }
}

export function createClaude360SecretStore(deps: Claude360SecretStoreDeps): Claude360SecretStore {
  const fs = deps.fileSystem ?? defaultFileSystem
  const safeStorage = deps.safeStorage

  function encryptionAvailable(): boolean {
    try {
      return safeStorage?.isEncryptionAvailable() === true
    } catch {
      return false
    }
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
  }

  return {
    isEncryptionActive: encryptionAvailable,

    async saveSecret(ref: string, value: string): Promise<void> {
      const records = readAll()
      if (encryptionAvailable() && safeStorage) {
        const encrypted = safeStorage.encryptString(value)
        records[ref] = { enc: true, data: Buffer.from(encrypted).toString('base64') }
      } else {
        // 显式降级：base64 混淆（非加密），标记 enc=false 以便上层提示用户。
        records[ref] = { enc: false, data: Buffer.from(value, 'utf8').toString('base64') }
      }
      writeAll(records)
    },

    async loadSecret(ref: string): Promise<string | null> {
      const record = readAll()[ref]
      if (!record) return null
      try {
        if (record.enc) {
          if (!safeStorage) return null
          return safeStorage.decryptString(Buffer.from(record.data, 'base64'))
        }
        return Buffer.from(record.data, 'base64').toString('utf8')
      } catch {
        return null
      }
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
