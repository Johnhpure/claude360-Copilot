import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

/**
 * Structured document content shared by the normal and official (GB/T 9704)
 * docx renderers. A document is an ordered list of blocks plus optional
 * official-公文 metadata that the official renderer maps to 公文要素.
 */
export type DocxBlock =
  | { type: 'heading'; level?: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'table'; rows: string[][] }

/** 公文要素 — only consumed by the official renderer; ignored by the normal one. */
export type OfficialMeta = {
  /** 发文机关 / sender (发文机关署名, also drives 发文机关标志). */
  sender?: string
  /** 发文字号, e.g. 京政发〔2026〕1号 */
  docNumber?: string
  /** 主送机关 */
  recipient?: string
  /** 成文日期, free text; rendered right-aligned. */
  date?: string
  /** 签发人 (for 请示 等上行文) */
  signer?: string
  /** 抄送机关 (版记) */
  cc?: string
  /** 印发机关和印发日期 (版记) */
  printedBy?: string
}

export type DocxContent = {
  title?: string
  blocks: DocxBlock[]
  official?: OfficialMeta
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4
}

/** Build the docx paragraph/table children for a block list (normal styling). */
export function blocksToChildren(blocks: DocxBlock[]): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = []
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'heading':
        children.push(
          new Paragraph({
            heading: HEADING_LEVELS[block.level ?? 1] ?? HeadingLevel.HEADING_1,
            children: [new TextRun({ text: block.text ?? '' })]
          })
        )
        break
      case 'paragraph':
        children.push(new Paragraph({ children: [new TextRun({ text: block.text ?? '' })] }))
        break
      case 'list':
        for (const item of Array.isArray(block.items) ? block.items : []) {
          children.push(
            new Paragraph({
              text: String(item ?? ''),
              ...(block.ordered
                ? { numbering: { reference: 'ordered-list', level: 0 } }
                : { bullet: { level: 0 } })
            })
          )
        }
        break
      case 'table':
        children.push(buildTable(block.rows))
        break
    }
  }
  return children
}

function buildTable(rows: string[][]): Table {
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
                  children: [new TextRun({ text: value, bold: rowIndex === 0 })]
                })
              ]
            })
          })
        })
    )
  })
}

/**
 * Render normal (non-公文) docx: a title heading followed by the block content.
 * Ordered lists reference a numbering config declared on the document.
 */
export async function renderDocx(content: DocxContent): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  if (content.title?.trim()) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: content.title.trim(), bold: true })]
      })
    )
  }
  children.push(...blocksToChildren(content.blocks))

  const doc = new Document({
    creator: 'Claude360 Copilot',
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }]
        }
      ]
    },
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ text: '' })] }]
  })

  return Packer.toBuffer(doc)
}
