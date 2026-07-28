import ExcelJS from 'exceljs'

/**
 * Structured input for a spreadsheet. Each sheet is a name plus a matrix of
 * rows; cells accept strings, numbers, booleans, or null (rendered blank).
 * A formula cell is expressed as `{ formula: 'SUM(A1:A3)' }`.
 */
export type XlsxCell = string | number | boolean | null | { formula: string }

export type XlsxSheet = {
  name?: string
  /** First row is styled as a bold header when `headerRow` is not false. */
  rows: XlsxCell[][]
  headerRow?: boolean
}

export type XlsxContent = {
  sheets: XlsxSheet[]
}

function normalizeCell(cell: XlsxCell): ExcelJS.CellValue {
  if (cell == null) return null
  if (typeof cell === 'object' && 'formula' in cell) {
    return { formula: cell.formula } as ExcelJS.CellValue
  }
  return cell as ExcelJS.CellValue
}

/**
 * Render a workbook to an .xlsx Buffer. Sheets get sensible defaults: a bold
 * header row, frozen top row, and auto-sized columns based on content width.
 */
export async function renderXlsx(content: XlsxContent): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Claude360 Copilot'
  workbook.created = new Date(0)

  const sheets = content.sheets?.length ? content.sheets : [{ rows: [] as XlsxCell[][] }]
  sheets.forEach((sheet, index) => {
    const name = sanitizeSheetName(sheet.name, index)
    const ws = workbook.addWorksheet(name)
    const rows = Array.isArray(sheet.rows) ? sheet.rows : []
    const hasHeader = sheet.headerRow !== false && rows.length > 0

    rows.forEach((row, rowIndex) => {
      const values = (Array.isArray(row) ? row : []).map(normalizeCell)
      const added = ws.addRow(values)
      if (hasHeader && rowIndex === 0) {
        added.font = { bold: true }
        added.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' }
          }
        })
      }
    })

    if (hasHeader) ws.views = [{ state: 'frozen', ySplit: 1 }]
    autoSizeColumns(ws, rows)
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}

/** Excel sheet names cannot exceed 31 chars or contain []:*?/\ */
function sanitizeSheetName(name: string | undefined, index: number): string {
  const fallback = `Sheet${index + 1}`
  const cleaned = (name ?? '').replace(/[[\]:*?/\\]/g, ' ').trim()
  return (cleaned || fallback).slice(0, 31)
}

function autoSizeColumns(ws: ExcelJS.Worksheet, rows: XlsxCell[][]): void {
  const widths: number[] = []
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : []
    cells.forEach((cell, col) => {
      const text =
        cell == null
          ? ''
          : typeof cell === 'object' && 'formula' in cell
            ? `=${cell.formula}`
            : String(cell)
      // Approximate width: CJK glyphs are ~2x the advance of Latin ones.
      let width = 0
      for (const ch of text) width += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
      widths[col] = Math.max(widths[col] ?? 0, width)
    })
  }
  widths.forEach((width, col) => {
    ws.getColumn(col + 1).width = Math.min(Math.max(width + 2, 8), 60)
  })
}
