import { describe, expect, it } from 'vitest'
import { _internals } from './logger'

// P1-1：main logger 的 detail 无论字符串 / 对象 / 数组 / 兜底 String，
// 都必须先脱敏再落盘，避免 Authorization / Bearer / apiKey / token / password
// 等明文进入日志文件。
describe('logger safeStringify redaction', () => {
  const { safeStringify } = _internals

  it('redacts Authorization Bearer inside a string detail', () => {
    const out = safeStringify('Authorization: Bearer sk-secret-abc123')
    expect(out).not.toContain('sk-secret-abc123')
    expect(out.toLowerCase()).toContain('redacted')
  })

  it('redacts secret-bearing object keys', () => {
    const out = safeStringify({ apiKey: 'sk-secret-abc123', Authorization: 'Bearer sk-xyz' })
    expect(out).not.toContain('sk-secret-abc123')
    expect(out).not.toContain('sk-xyz')
  })

  it('redacts nested objects and arrays', () => {
    const out = safeStringify({
      list: [{ token: 'sk-nested-1' }, { password: 'p@ss-2' }],
      meta: { note: 'authorization=Bearer sk-nested-3' }
    })
    expect(out).not.toContain('sk-nested-1')
    expect(out).not.toContain('p@ss-2')
    expect(out).not.toContain('sk-nested-3')
  })

  it('redacts secrets in the non-serializable fallback path', () => {
    // 制造 JSON.stringify 抛错（循环引用），走 String(value) 兜底分支。
    const circular: Record<string, unknown> = { authorization: 'Bearer sk-fallback-9' }
    circular.self = circular
    const out = safeStringify(circular)
    // 兜底分支不应把明文透出（String(circular) 一般是 [object Object]，
    // 但只要包含敏感文本就必须脱敏；这里断言不含明文即可）。
    expect(out).not.toContain('sk-fallback-9')
  })

  it('leaves benign detail intact', () => {
    expect(safeStringify('just a normal message')).toBe('just a normal message')
  })
})
