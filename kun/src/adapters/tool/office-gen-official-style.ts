import {
  AlignmentType,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { DocxBlock, DocxContent, OfficialMeta } from './office-gen-docx.js'

/**
 * GB/T 9704-2012《党政机关公文格式》 renderer.
 *
 * Encodes the national-standard layout that html-to-docx's CSS approximation
 * cannot hit precisely:
 *   - 版心 page margins 上37 / 下35 / 左28 / 右26 mm on A4
 *   - 正文 仿宋_GB2312 三号 (16pt), fixed 28pt line spacing, ~28 chars/line
 *   - 标题 方正小标宋 二号; 一级标题 黑体, 二级 楷体, 三级 仿宋加粗
 *   - 发文字号 / 主送机关 / 正文 / 发文机关署名 / 成文日期(右对齐) / 版记
 *
 * Honest boundary: docx only records FONT NAMES. Whether 仿宋_GB2312 /
 * 方正小标宋 actually render depends on fonts installed on the machine that
 * opens the file; missing fonts fall back (layout preserved, glyphs differ).
 */

// Unit helpers. docx uses twips (1pt = 20 twips); 1mm ≈ 56.6929 twips.
const mm = (value: number): number => Math.round(value * 56.6929)
const pt = (value: number): number => value * 2 // half-points for font sizes

// GB/T 9704 版心 margins.
const PAGE_MARGIN = {
  top: mm(37),
  bottom: mm(35),
  left: mm(28),
  right: mm(26)
}

// 固定行距 28 磅 (spacing.line is in twips when lineRule = exact).
const LINE_28PT = { line: 28 * 20, lineRule: LineRuleType.EXACT }

// Fonts.
const FONT_BODY = '仿宋_GB2312'
const FONT_TITLE = '方正小标宋简体'
const FONT_H1 = '黑体'
const FONT_H2 = '楷体_GB2312'

// Sizes (half-points). 二号=22pt, 三号=16pt, 小二=18pt.
const SIZE_TITLE = pt(22)
const SIZE_BODY = pt(16)
const SIZE_H1 = pt(16)

function bodyRun(text: string, overrides: Partial<{ font: string; size: number; bold: boolean }> = {}): TextRun {
  return new TextRun({
    text,
    font: overrides.font ?? FONT_BODY,
    size: overrides.size ?? SIZE_BODY,
    ...(overrides.bold ? { bold: true } : {})
  })
}

function officialBlock(block: DocxBlock): (Paragraph | Table)[] {
  if (!block || typeof block !== 'object') return []
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 1
      const font = level === 1 ? FONT_H1 : level === 2 ? FONT_H2 : FONT_BODY
      return [
        new Paragraph({
          spacing: LINE_28PT,
          children: [bodyRun(block.text ?? '', { font, size: SIZE_H1, bold: level >= 3 })]
        })
      ]
    }
    case 'paragraph':
      return [
        new Paragraph({
          spacing: LINE_28PT,
          // 公文正文首行缩进 2 字符 (三号字 ≈ 32 half-points ⇒ 2 chars ≈ 640 twips).
          indent: { firstLine: mm(11.3) },
          alignment: AlignmentType.JUSTIFIED,
          children: [bodyRun(block.text ?? '')]
        })
      ]
    case 'list':
      return (Array.isArray(block.items) ? block.items : []).map(
        (item, index) =>
          new Paragraph({
            spacing: LINE_28PT,
            indent: { firstLine: mm(11.3) },
            children: [bodyRun(block.ordered ? `${index + 1}. ${item ?? ''}` : `— ${item ?? ''}`)]
          })
      )
    case 'table':
      return [officialTable(block.rows)]
    default:
      return []
  }
}

function officialTable(rows: string[][]): Table {
  const matrix = Array.isArray(rows) ? rows : []
  const width = matrix.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0)
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: matrix.map(
      (row, rowIndex) =>
        new TableRow({
          children: Array.from({ length: width }, (_, col) => {
            const value = String((Array.isArray(row) ? row[col] : '') ?? '')
            return new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [bodyRun(value, { bold: rowIndex === 0 })]
                })
              ]
            })
          })
        })
    )
  })
}

/** Build the 公文 head elements (发文字号, 标题, 主送机关) before the body. */
function buildHead(content: DocxContent, meta: OfficialMeta): Paragraph[] {
  const head: Paragraph[] = []

  if (meta.docNumber?.trim()) {
    head.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240, ...LINE_28PT },
        children: [bodyRun(meta.docNumber.trim())]
      })
    )
  }

  if (content.title?.trim()) {
    head.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 360, ...LINE_28PT },
        children: [new TextRun({ text: content.title.trim(), font: FONT_TITLE, size: SIZE_TITLE, bold: true })]
      })
    )
  }

  if (meta.recipient?.trim()) {
    head.push(
      new Paragraph({
        alignment: AlignmentType.START,
        spacing: LINE_28PT,
        children: [bodyRun(`${meta.recipient.trim()}：`)]
      })
    )
  }

  return head
}

/** Build the 落款 (发文机关署名 + 成文日期, right-aligned) after the body. */
function buildSignoff(meta: OfficialMeta): Paragraph[] {
  const tail: Paragraph[] = []
  if (meta.sender?.trim()) {
    tail.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 480, ...LINE_28PT },
        children: [bodyRun(meta.sender.trim())]
      })
    )
  }
  if (meta.date?.trim()) {
    tail.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: LINE_28PT,
        children: [bodyRun(meta.date.trim())]
      })
    )
  }
  return tail
}

/** Build the 版记 (抄送机关 + 印发机关和印发日期) separated by a rule. */
function buildVersionNote(meta: OfficialMeta): Paragraph[] {
  const note: Paragraph[] = []
  if (meta.cc?.trim()) {
    note.push(
      new Paragraph({
        spacing: { before: 480, ...LINE_28PT },
        border: { top: { style: 'single', size: 6, color: '000000', space: 1 } },
        children: [bodyRun(`抄送：${meta.cc.trim()}`)]
      })
    )
  }
  if (meta.printedBy?.trim()) {
    note.push(
      new Paragraph({
        spacing: LINE_28PT,
        children: [bodyRun(meta.printedBy.trim())]
      })
    )
  }
  return note
}

/** Render a GB/T 9704 official document to a Buffer. */
export async function renderOfficialDocx(content: DocxContent): Promise<Buffer> {
  const meta = content.official ?? {}
  const body = (Array.isArray(content.blocks) ? content.blocks : []).flatMap(officialBlock)

  const children = [
    ...buildHead(content, meta),
    ...(body.length > 0 ? body : [new Paragraph({ spacing: LINE_28PT, children: [bodyRun('')] })]),
    ...buildSignoff(meta),
    ...buildVersionNote(meta)
  ]

  const doc = new Document({
    creator: 'Claude360 Copilot',
    styles: {
      default: {
        document: {
          run: { font: FONT_BODY, size: SIZE_BODY }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: mm(210), height: mm(297) },
            margin: PAGE_MARGIN
          }
        },
        children
      }
    ]
  })

  return Packer.toBuffer(doc)
}
