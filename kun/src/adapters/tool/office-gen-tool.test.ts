import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOfficeGenLocalTool } from './office-gen-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const tool = createOfficeGenLocalTool()
let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'office-gen-'))
})

afterEach(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

function ctx(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 't1',
    turnId: 'u1',
    workspace,
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

type OkOutput = {
  path: string
  bytes_written: number
  files: Array<{ name: string; absolutePath: string; mimeType: string; byteSize: number }>
  style?: string
  note?: string
}

async function run(args: Record<string, unknown>): Promise<{ output: OkOutput; isError?: boolean }> {
  const result = await tool.execute(args, ctx())
  return result as { output: OkOutput; isError?: boolean }
}

/** Read a single entry's text out of an OOXML (zip) buffer. */
async function readZipEntry(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const file = zip.file(path)
  if (!file) throw new Error(`missing zip entry: ${path}`)
  return file.async('string')
}

describe('create_document tool metadata', () => {
  it('advertises as an on-request file_change tool', () => {
    expect(tool.name).toBe('create_document')
    expect(tool.toolKind).toBe('file_change')
    expect(tool.policy).toBe('on-request')
  })
})

describe('create_document — docx (normal)', () => {
  it('renders title and blocks into a real docx and returns a downloadable file', async () => {
    const { output, isError } = await run({
      format: 'docx',
      path: 'report',
      content: {
        title: 'Quarterly Report',
        blocks: [
          { type: 'heading', level: 1, text: 'Overview' },
          { type: 'paragraph', text: 'Revenue grew steadily.' },
          { type: 'table', rows: [['Name', 'Score'], ['Alice', '91']] }
        ]
      }
    })
    expect(isError).toBeFalsy()
    // Extension auto-appended.
    expect(output.path.endsWith('.docx')).toBe(true)
    expect(output.bytes_written).toBeGreaterThan(0)
    // Download artifact present for the GUI card.
    expect(output.files).toHaveLength(1)
    expect(output.files[0]!.mimeType).toContain('wordprocessingml')
    expect(output.files[0]!.absolutePath).toBe(output.path)

    const buffer = await readFile(output.path)
    const documentXml = await readZipEntry(buffer, 'word/document.xml')
    expect(documentXml).toContain('Quarterly Report')
    expect(documentXml).toContain('Overview')
    expect(documentXml).toContain('Revenue grew steadily')
    expect(documentXml).toContain('Alice')
  })
})

describe('create_document — docx (official GB/T 9704)', () => {
  it('applies national-standard fonts, page margins, and 公文要素', async () => {
    const { output, isError } = await run({
      format: 'docx',
      path: '通知.docx',
      style: 'official',
      content: {
        title: '关于开展年度考核的通知',
        blocks: [{ type: 'paragraph', text: '现将有关事项通知如下。' }],
        official: {
          sender: '某某市人民政府',
          docNumber: '某政发〔2026〕1号',
          recipient: '各区县人民政府',
          date: '2026年7月28日',
          cc: '市委办公室',
          printedBy: '某某市人民政府办公室  2026年7月28日印发'
        }
      }
    })
    expect(isError).toBeFalsy()
    expect(output.style).toBe('official')
    expect(output.note).toContain('GB/T 9704')

    const buffer = await readFile(output.path)
    const documentXml = await readZipEntry(buffer, 'word/document.xml')
    // 公文要素 present.
    expect(documentXml).toContain('某政发〔2026〕1号')
    expect(documentXml).toContain('关于开展年度考核的通知')
    expect(documentXml).toContain('各区县人民政府')
    expect(documentXml).toContain('某某市人民政府')
    expect(documentXml).toContain('抄送：市委办公室')
    // National-standard body font.
    expect(documentXml).toContain('仿宋_GB2312')
    // A4 page margins: top 37mm ≈ 2098 twips, left 28mm ≈ 1587 twips.
    expect(documentXml).toMatch(/w:top="209[0-9]"/)
    expect(documentXml).toMatch(/w:left="158[0-9]"/)
  })
})

describe('create_document — xlsx', () => {
  it('renders multi-sheet workbooks readable back via exceljs', async () => {
    const { output, isError } = await run({
      format: 'xlsx',
      path: 'grades',
      content: {
        sheets: [
          { name: 'Grades', rows: [['Name', 'Score'], ['Alice', 91], ['Bob', 84]] },
          { name: 'Summary', rows: [['Region', 'Total'], ['North', 12]] }
        ]
      }
    })
    expect(isError).toBeFalsy()
    expect(output.files[0]!.mimeType).toContain('spreadsheetml')

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(output.path)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Grades', 'Summary'])
    expect(wb.getWorksheet('Grades')!.getCell('A1').value).toBe('Name')
    expect(wb.getWorksheet('Grades')!.getCell('B2').value).toBe(91)
    expect(wb.getWorksheet('Summary')!.getCell('A2').value).toBe('North')
  })
})

describe('create_document — pptx', () => {
  it('renders slides with titles, bullets, and speaker notes', async () => {
    const { output, isError } = await run({
      format: 'pptx',
      path: 'deck',
      content: {
        slides: [{ title: 'Launch Plan', bullets: ['Ship in Q3', 'Announce widely'], notes: 'Remember the budget' }]
      }
    })
    expect(isError).toBeFalsy()
    expect(output.files[0]!.mimeType).toContain('presentationml')

    const buffer = await readFile(output.path)
    const slideXml = await readZipEntry(buffer, 'ppt/slides/slide1.xml')
    expect(slideXml).toContain('Launch Plan')
    expect(slideXml).toContain('Ship in Q3')
    const notesXml = await readZipEntry(buffer, 'ppt/notesSlides/notesSlide1.xml')
    expect(notesXml).toContain('Remember the budget')
  })
})

describe('create_document — validation & sandbox', () => {
  it('rejects an unsupported format', async () => {
    const { isError } = await run({ format: 'rtf', path: 'x', content: {} })
    expect(isError).toBe(true)
  })

  it('rejects a missing path', async () => {
    const { isError } = await run({ format: 'docx', path: '  ', content: { blocks: [] } })
    expect(isError).toBe(true)
  })

  it('rejects paths escaping the workspace root under a bounded sandbox', async () => {
    // Under danger-full-access the workspace boundary is intentionally not
    // enforced, so pick a bounded mode to exercise the escape guard.
    const result = await tool.execute(
      { format: 'docx', path: '../escape.docx', content: { blocks: [] } },
      ctx({ sandboxMode: 'workspace-write' })
    )
    expect(result.isError).toBe(true)
  })

  it('rejects writes under a read-only sandbox', async () => {
    const result = await tool.execute(
      { format: 'docx', path: 'blocked.docx', content: { blocks: [] } },
      ctx({ sandboxMode: 'read-only' })
    )
    expect(result.isError).toBe(true)
  })
})
