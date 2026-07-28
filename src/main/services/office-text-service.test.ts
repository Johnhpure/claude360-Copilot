import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearOfficeTextCache, readLocalOfficeText } from './office-text-service'

async function writeTempFile(name: string, data: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ds-office-text-'))
  await mkdir(join(dir, 'docs'), { recursive: true })
  const filePath = join(dir, 'docs', name)
  await writeFile(filePath, data)
  return filePath
}

/** Build a minimal .xlsx with two sheets using SheetJS. */
async function createWorkbook(): Promise<Buffer> {
  const xlsx = await import('xlsx')
  const wb = xlsx.utils.book_new()
  const sheet1 = xlsx.utils.aoa_to_sheet([
    ['Name', 'Score'],
    ['Alice', 91],
    ['Bob', 84]
  ])
  const sheet2 = xlsx.utils.aoa_to_sheet([['Region', 'Total'], ['North', 12]])
  xlsx.utils.book_append_sheet(wb, sheet1, 'Grades')
  xlsx.utils.book_append_sheet(wb, sheet2, 'Summary')
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Build a minimal .docx from HTML so mammoth can round-trip it back to Markdown. */
async function createDocx(): Promise<Buffer> {
  const htmlToDocx = (await import('html-to-docx')).default as (
    html: string
  ) => Promise<Buffer | ArrayBuffer>
  const html =
    '<html><body><h1>Quarterly Report</h1><p>Revenue grew steadily.</p></body></html>'
  const out = await htmlToDocx(html)
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
}

/** Build a minimal .pptx (one slide + speaker notes) as an OOXML zip. */
async function createPptx(): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const drawing = (text: string): string =>
    `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
    `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`
  zip.file('ppt/slides/slide1.xml', drawing('Launch Plan'))
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    `<?xml version="1.0"?><p:notes xmlns:p="p" xmlns:a="a"><a:t>Remember the budget</a:t></p:notes>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

afterEach(() => {
  clearOfficeTextCache()
})

describe('office text service', () => {
  it('extracts multi-sheet spreadsheets as Markdown tables', async () => {
    const filePath = await writeTempFile('grades.xlsx', await createWorkbook())
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(2)
    expect(result.hasText).toBe(true)
    expect(result.text).toContain('## Grades')
    expect(result.text).toContain('## Summary')
    expect(result.text).toContain('| Name | Score |')
    expect(result.text).toContain('| Alice | 91 |')
  })

  it('extracts docx structure as Markdown', async () => {
    const filePath = await writeTempFile('report.docx', await createDocx())
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain('Quarterly Report')
    expect(result.text).toContain('Revenue grew steadily')
  })

  it('extracts pptx slides and speaker notes', async () => {
    const filePath = await writeTempFile('deck.pptx', await createPptx())
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pageCount).toBe(1)
    expect(result.text).toContain('Slide 1')
    expect(result.text).toContain('Launch Plan')
    expect(result.text).toContain('Remember the budget')
  })

  it('rejects legacy binary formats with a clear message', async () => {
    const filePath = await writeTempFile('old.doc', Buffer.from('legacy binary'))
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('.doc')
  })

  it('rejects unsupported extensions', async () => {
    const filePath = await writeTempFile('notes.txt', Buffer.from('plain'))
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-container payload instead of inventing content', async () => {
    // A renamed/corrupt .xlsx that isn't a ZIP must not be coerced by SheetJS's
    // lenient reader into a bogus one-cell sheet — the signature guard rejects it.
    const filePath = await writeTempFile('broken.xlsx', Buffer.from('not a real workbook'))
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(false)
  })

  it('returns ok:false for a corrupt docx instead of throwing', async () => {
    const filePath = await writeTempFile('broken.docx', Buffer.from('not a real docx'))
    const result = await readLocalOfficeText({ path: filePath })
    expect(result.ok).toBe(false)
  })
})
