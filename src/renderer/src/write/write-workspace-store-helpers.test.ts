import { afterEach, describe, expect, it } from 'vitest'
import {
  WRITE_ASSISTANT_MODEL_KEY,
  normalizeWriteAssistantModel,
  readStoredAssistantModel
} from './write-workspace-store-helpers'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function installStorage(): MemoryStorage {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })
  return storage
}

function restoreLocalStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

afterEach(() => {
  restoreLocalStorage()
})

describe('write workspace assistant model helpers', () => {
  it('normalizes empty and legacy auto assistant models to "" (runtime default model)', () => {
    expect(normalizeWriteAssistantModel('')).toBe('')
    expect(normalizeWriteAssistantModel('auto')).toBe('')
    expect(normalizeWriteAssistantModel(' AUTO ')).toBe('')
    expect(normalizeWriteAssistantModel('custom-model')).toBe('custom-model')
  })

  it('migrates the stored legacy auto assistant model to "" (runtime default model)', () => {
    const storage = installStorage()
    storage.setItem(WRITE_ASSISTANT_MODEL_KEY, 'auto')

    expect(readStoredAssistantModel()).toBe('')
    expect(storage.getItem(WRITE_ASSISTANT_MODEL_KEY)).toBe('')
  })
})
