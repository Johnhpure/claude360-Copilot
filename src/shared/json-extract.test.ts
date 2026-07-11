import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './json-extract'

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"name":"demo","count":2}')).toEqual({ name: 'demo', count: 2 })
  })

  it('strips ```json code fences', () => {
    const raw = '```json\n{"prompts":["a","b"]}\n```'
    expect(extractJsonObject(raw)).toEqual({ prompts: ['a', 'b'] })
  })

  it('strips anonymous ``` fences', () => {
    expect(extractJsonObject('```\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('falls back to the first {...} block inside surrounding prose', () => {
    const raw = '好的，以下是结果：\n{"name":"工作流","variables":[]}\n希望对你有帮助。'
    expect(extractJsonObject(raw)).toEqual({ name: '工作流', variables: [] })
  })

  it('handles nested objects in the fallback match', () => {
    const raw = 'result: {"a":{"b":1},"c":[{"d":2}]} done'
    expect(extractJsonObject(raw)).toEqual({ a: { b: 1 }, c: [{ d: 2 }] })
  })

  it('returns null for arrays, primitives and unparseable text', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull()
    expect(extractJsonObject('42')).toBeNull()
    expect(extractJsonObject('"just a string"')).toBeNull()
    expect(extractJsonObject('no json here')).toBeNull()
    expect(extractJsonObject('{broken json')).toBeNull()
    expect(extractJsonObject('')).toBeNull()
  })
})
