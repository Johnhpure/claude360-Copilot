import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'

/**
 * Professional-grade Office document text extraction for chat attachments.
 *
 * Mirrors the conventions of `write-pdf-text-service.ts`: same result shape,
 * the same byte / char ceilings, the same LRU cache keyed by
 * `path:size:mtimeMs`, and the same "never throw, return { ok:false }" error
 * contract. The GUI treats the extracted text exactly like PDF text — a
 * `kind:'document'` attachment carrying `documentText`.
 *
 * Each format is dispatched to the most capable pure-JS extractor and rendered
 * as structured Markdown so the model sees tables, headings, sheet boundaries,
 * and speaker notes rather than a flattened blob:
 *   - .docx → mammoth (Word → HTML → Markdown, preserves structure)
 *   - .xlsx / .xls → SheetJS (multi-sheet, Markdown tables)
 *   - .pptx → jszip + fast-xml-parser (per-slide text + speaker notes)
 */

const MAX_OFFICE_TEXT_BYTES = 64 * 1024 * 1024
const MAX_OFFICE_TEXT_CHARS = 1_000_000

export type OfficeTextResult =
  | {
      ok: true
      path: string
      size: number
      mtimeMs: number
      /** Best-effort logical unit count: sheets for Excel, slides for PPT, 0 for Word. */
      pageCount: number
      text: string
      hasText: boolean
      truncated: boolean
    }
  | {
      ok: false
      message: string
    }

/** Extension → extractor kind. Extensions not listed here are rejected. */
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.xlsx', '.xls', '.pptx'])

const officeTextCache = new Map<string, Promise<OfficeTextResult>>()

function compactText(text = ''): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Clamp accumulated text to the char ceiling, reporting whether truncation occurred. */
function clampToLimit(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OFFICE_TEXT_CHARS) return { text, truncated: false }
  return { text: text.slice(0, MAX_OFFICE_TEXT_CHARS).trim(), truncated: true }
}

// ---------------------------------------------------------------------------
// .docx — mammoth
// ---------------------------------------------------------------------------

/**
 * `convertToMarkdown` exists at runtime but is missing from mammoth's shipped
 * type declarations (only `convertToHtml` is typed). Declare the slice we use.
 */
type MammothMarkdown = {
  convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>
}

async function extractDocx(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const mammoth = (await import('mammoth')) as unknown as MammothMarkdown
  // Markdown conversion preserves headings, lists, and table structure.
  const result = await mammoth.convertToMarkdown({ buffer: bytes })
  return { text: compactText(result.value), pageCount: 0 }
}

// ---------------------------------------------------------------------------
// .xlsx / .xls — SheetJS
// ---------------------------------------------------------------------------

async function extractSpreadsheet(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const xlsx = await import('xlsx')
  const workbook = xlsx.read(bytes, { type: 'buffer' })
  const sheetNames = workbook.SheetNames ?? []
  const sections: string[] = []
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    // Markdown-friendly rendering: each sheet becomes a heading + GFM table.
    const rows = xlsx.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: ''
    })
    const nonEmpty = rows.filter((row) => row.some((cell) => String(cell ?? '').trim()))
    if (nonEmpty.length === 0) {
      sections.push(`## ${name}\n\n_(empty sheet)_`)
      continue
    }
    const table = renderMarkdownTable(nonEmpty)
    sections.push(`## ${name}\n\n${table}`)
  }
  return { text: compactText(sections.join('\n\n')), pageCount: sheetNames.length }
}

/** Render a matrix as a GitHub-flavored Markdown table using the widest row as the header width. */
function renderMarkdownTable(rows: string[][]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (width === 0) return ''
  const escapeCell = (value: unknown): string => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
  const pad = (row: string[]): string[] => {
    const cells = row.map(escapeCell)
    while (cells.length < width) cells.push('')
    return cells
  }
  const [header, ...body] = rows
  const headerCells = pad(header ?? [])
  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`)
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// .pptx — jszip + fast-xml-parser
// ---------------------------------------------------------------------------

async function extractPptx(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const [{ default: JSZip }, { XMLParser }] = await Promise.all([
    import('jszip'),
    import('fast-xml-parser')
  ])
  const zip = await JSZip.loadAsync(bytes)
  const parser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' })

  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(slideNumberComparator)
  const noteEntries = new Map<number, string>()
  for (const name of Object.keys(zip.files)) {
    const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(name)
    if (match) noteEntries.set(Number(match[1]), name)
  }

  const sections: string[] = []
  for (let index = 0; index < slideEntries.length; index += 1) {
    const slideName = slideEntries[index]!
    const slideXml = await zip.files[slideName]!.async('string')
    const slideText = collectDrawingText(parser.parse(slideXml))
    const parts = [`## Slide ${index + 1}`]
    if (slideText.trim()) parts.push(slideText.trim())
    const noteName = noteEntries.get(index + 1)
    if (noteName) {
      const noteXml = await zip.files[noteName]!.async('string')
      const noteText = collectDrawingText(parser.parse(noteXml)).trim()
      if (noteText) parts.push(`**Notes:** ${noteText}`)
    }
    sections.push(parts.join('\n\n'))
  }
  return { text: compactText(sections.join('\n\n')), pageCount: slideEntries.length }
}

function slideNumberComparator(a: string, b: string): number {
  const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0)
  const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0)
  return na - nb
}

/**
 * Walk a parsed DrawingML tree collecting every text run in document order.
 * PowerPoint text lives in `a:t` nodes; fast-xml-parser keeps the `a:` prefix,
 * so string/number leaves anywhere in the tree are the actual glyphs. We
 * collect every leaf, which naturally captures `a:t` runs without depending on
 * the exact namespace prefix.
 */
function collectDrawingText(node: unknown): string {
  const parts: string[] = []
  const visit = (value: unknown): void => {
    if (value == null) return
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) parts.push(text)
      return
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (typeof value === 'object') {
      for (const child of Object.values(value as Record<string, unknown>)) visit(child)
    }
  }
  visit(node)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Dispatch + public API
// ---------------------------------------------------------------------------

/** ZIP local-file-header magic: OOXML (.docx/.xlsx/.pptx) are ZIP containers. */
function isZipContainer(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
}

/** OLE2 compound-file magic: legacy .xls (BIFF) uses this container. */
function isOleCompoundFile(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  )
}

/**
 * Reject files whose bytes don't match the container their extension claims.
 * Without this, SheetJS's lenient reader turns arbitrary bytes into a bogus
 * one-cell spreadsheet, so a renamed / corrupt file would silently produce
 * garbage "content" instead of a clear error.
 */
function containerMatchesExtension(ext: string, bytes: Buffer): boolean {
  switch (ext) {
    case '.docx':
    case '.xlsx':
    case '.pptx':
      return isZipContainer(bytes)
    case '.xls':
      // Modern .xlsx renamed to .xls is still a ZIP; genuine legacy .xls is OLE2.
      return isOleCompoundFile(bytes) || isZipContainer(bytes)
    default:
      return false
  }
}

async function extractOffice(
  targetPath: string,
  ext: string,
  size: number,
  mtimeMs: number
): Promise<OfficeTextResult> {
  const bytes = await readFile(targetPath)
  if (!containerMatchesExtension(ext, bytes)) {
    return { ok: false, message: 'This file is not a valid Office document (unexpected file format).' }
  }
  let extracted: { text: string; pageCount: number }
  switch (ext) {
    case '.docx':
      extracted = await extractDocx(bytes)
      break
    case '.xlsx':
    case '.xls':
      extracted = await extractSpreadsheet(bytes)
      break
    case '.pptx':
      extracted = await extractPptx(bytes)
      break
    default:
      return { ok: false, message: `Unsupported Office format: ${ext}` }
  }
  const clamped = clampToLimit(extracted.text)
  return {
    ok: true,
    path: targetPath,
    size,
    mtimeMs,
    pageCount: extracted.pageCount,
    text: clamped.text,
    hasText: clamped.text.trim().length > 0,
    truncated: clamped.truncated
  }
}

export async function readLocalOfficeText(payload: { path: string }): Promise<OfficeTextResult> {
  try {
    return await readLocalOfficeTextByPath(payload.path)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function readLocalOfficeTextByPath(targetPath: string): Promise<OfficeTextResult> {
  const ext = extname(targetPath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    // Legacy binary .doc/.ppt are intentionally out of scope for this phase.
    if (ext === '.doc' || ext === '.ppt') {
      return { ok: false, message: `Legacy ${ext} files are not supported yet. Please convert to ${ext}x.` }
    }
    return { ok: false, message: 'This file is not a supported Office document.' }
  }

  const fileInfo = await stat(targetPath)
  if (fileInfo.isDirectory()) return { ok: false, message: 'Cannot read text from a directory.' }
  if (fileInfo.size > MAX_OFFICE_TEXT_BYTES) {
    return { ok: false, message: 'This document is too large to attach.' }
  }

  const cacheKey = `${targetPath}:${fileInfo.size}:${fileInfo.mtimeMs}`
  const cached = officeTextCache.get(cacheKey)
  if (cached) return cached

  const pending = extractOffice(targetPath, ext, fileInfo.size, fileInfo.mtimeMs).finally(() => {
    if (officeTextCache.size > 32) {
      const oldest = officeTextCache.keys().next().value
      if (oldest) officeTextCache.delete(oldest)
    }
  })
  officeTextCache.set(cacheKey, pending)
  return pending
}

export function clearOfficeTextCache(): void {
  officeTextCache.clear()
}
