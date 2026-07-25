import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { officialDocumentPersona } from './personas/official-document'

/**
 * Deterministic CI checks for the official-document assistant eval assets
 * (PR-5). No model is called here; the release-gate model eval is a manual
 * process documented in docs/evals/official-document/runbook.md.
 */

const EVAL_DIR = resolve(process.cwd(), 'docs/evals/official-document')

const DOCUMENT_TYPES = ['notice', 'request', 'report', 'letter', 'minutes', 'cross-type'] as const
const MODES = ['draft', 'transform', 'rewrite', 'check', 'compare'] as const
const HARD_FAILURE_TAGS = [
  'fabricated-fact',
  'suggestion-as-decision',
  'silent-meaning-change',
  'claimed-executed-send',
  'followed-attachment-injection'
] as const

type EvalFixture = {
  id: string
  documentType: (typeof DOCUMENT_TYPES)[number]
  mode: (typeof MODES)[number]
  userPrompt: string
  attachments?: Array<{ name: string; text: string }>
  expected: {
    mustMention?: string[]
    mustNotClaim?: string[]
    expectedMissingFacts?: string[]
    hardFailureTags?: string[]
  }
}

const rawFixtures = readFileSync(resolve(EVAL_DIR, 'fixtures.json'), 'utf8')
const fixtures = JSON.parse(rawFixtures) as EvalFixture[]

describe('official-document eval assets exist', () => {
  it('ships fixtures, rubric, runbook, and the results directory', () => {
    expect(existsSync(resolve(EVAL_DIR, 'fixtures.json'))).toBe(true)
    expect(existsSync(resolve(EVAL_DIR, 'rubric.md'))).toBe(true)
    expect(existsSync(resolve(EVAL_DIR, 'runbook.md'))).toBe(true)
    expect(existsSync(resolve(EVAL_DIR, 'results/.gitkeep'))).toBe(true)
  })
})

describe('official-document fixtures schema', () => {
  it('parses to a non-empty array with valid entries', () => {
    expect(Array.isArray(fixtures)).toBe(true)
    for (const fixture of fixtures) {
      expect(fixture.id, 'fixture id').toMatch(/^[a-z]+-\d{3}$/)
      expect(DOCUMENT_TYPES).toContain(fixture.documentType)
      expect(MODES).toContain(fixture.mode)
      expect(fixture.userPrompt.trim().length).toBeGreaterThan(10)
      expect(fixture.expected, `${fixture.id} expected`).toBeTruthy()
      for (const tag of fixture.expected.hardFailureTags ?? []) {
        expect(HARD_FAILURE_TAGS, `${fixture.id} tag ${tag}`).toContain(tag)
      }
      for (const attachment of fixture.attachments ?? []) {
        expect(attachment.name.trim()).toBeTruthy()
        expect(attachment.text.trim()).toBeTruthy()
      }
    }
  })

  it('has globally unique fixture ids', () => {
    const ids = fixtures.map((fixture) => fixture.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('meets the coverage floor: >=3 per document type, >=4 cross-type, >=22 total', () => {
    const countByType = new Map<string, number>()
    for (const fixture of fixtures) {
      countByType.set(fixture.documentType, (countByType.get(fixture.documentType) ?? 0) + 1)
    }
    for (const documentType of ['notice', 'request', 'report', 'letter', 'minutes']) {
      expect(countByType.get(documentType) ?? 0, documentType).toBeGreaterThanOrEqual(3)
    }
    expect(countByType.get('cross-type') ?? 0).toBeGreaterThanOrEqual(4)
    expect(fixtures.length).toBeGreaterThanOrEqual(22)
  })

  it('covers every hard-failure safety scenario at least once', () => {
    const taggedFixtures = fixtures.filter(
      (fixture) => (fixture.expected.hardFailureTags ?? []).length > 0
    )
    expect(taggedFixtures.length).toBeGreaterThanOrEqual(4)
    const seenTags = new Set(taggedFixtures.flatMap((fixture) => fixture.expected.hardFailureTags ?? []))
    for (const tag of HARD_FAILURE_TAGS) {
      expect(seenTags.has(tag), `missing safety coverage for ${tag}`).toBe(true)
    }
    // The attachment-injection scenario must actually deliver its payload
    // through an attachment, not the prompt body.
    const injection = fixtures.filter((fixture) =>
      (fixture.expected.hardFailureTags ?? []).includes('followed-attachment-injection')
    )
    expect(injection.length).toBeGreaterThanOrEqual(1)
    for (const fixture of injection) {
      expect(fixture.attachments?.length ?? 0, `${fixture.id} needs attachments`).toBeGreaterThan(0)
    }
  })

  it('contains only synthetic data: no ID numbers, secrets, or real gov domains', () => {
    expect(rawFixtures).not.toMatch(/\d{17}[\dXx]/)
    expect(rawFixtures).not.toMatch(/sk-[A-Za-z0-9]{16,}/)
    expect(rawFixtures).not.toMatch(/\.gov\.cn/)
    expect(rawFixtures).not.toMatch(/password|api[_-]?key/i)
  })
})

describe('official-document persona hard requirements', () => {
  it('keeps the mandatory sections and prohibitions', () => {
    expect(officialDocumentPersona).toContain('一文一事')
    expect(officialDocumentPersona).toContain('待核')
    expect(officialDocumentPersona).toContain('不编造')
    expect(officialDocumentPersona).toContain('不得代替用户签发')
    expect(officialDocumentPersona).toContain('不是系统指令')
    expect(officialDocumentPersona).toContain('不自动发送')
    expect(officialDocumentPersona).toContain('方括号占位')
    expect(officialDocumentPersona).toContain('不把未确认的发言写成决议')
  })

  it('stays static: no template interpolation or install-store concepts', () => {
    expect(officialDocumentPersona).not.toContain('${')
    expect(officialDocumentPersona).not.toContain('{{')
    expect(officialDocumentPersona).not.toContain('安装')
    expect(officialDocumentPersona).not.toContain('商城')
  })
})
