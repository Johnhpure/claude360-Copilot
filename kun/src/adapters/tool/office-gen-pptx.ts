import PptxGenJS from 'pptxgenjs'

/**
 * Structured input for a slide deck. Each slide has an optional title, a list
 * of bullet lines, optional speaker notes, and an optional simple table.
 */
export type PptxSlide = {
  title?: string
  bullets?: string[]
  notes?: string
  table?: string[][]
}

export type PptxContent = {
  slides: PptxSlide[]
  /** Deck-level subtitle rendered under the first slide title when present. */
  subtitle?: string
}

const TITLE_OPTS = { x: 0.5, y: 0.3, w: 9, h: 0.9, fontSize: 28, bold: true } as const
const BODY_OPTS = { x: 0.5, y: 1.4, w: 9, h: 4.6, fontSize: 18, valign: 'top' } as const

/**
 * Render a deck to a .pptx Buffer. Each slide gets a title band, a bulleted
 * body (or a table when provided), and optional speaker notes.
 */
export async function renderPptx(content: PptxContent): Promise<Buffer> {
  const pptx = new PptxGenJS()
  pptx.author = 'Claude360 Copilot'
  pptx.layout = 'LAYOUT_WIDE'

  const slides = content.slides?.length ? content.slides : [{ title: '' }]
  slides.forEach((slide) => {
    const s = pptx.addSlide()
    if (slide.title?.trim()) {
      s.addText(slide.title.trim(), { ...TITLE_OPTS })
    }

    if (Array.isArray(slide.table) && slide.table.length > 0) {
      const rows = slide.table.map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => ({ text: String(cell ?? '') }))
      )
      s.addTable(rows, {
        x: 0.5,
        y: 1.4,
        w: 9,
        border: { type: 'solid', pt: 1, color: 'CCCCCC' },
        fontSize: 14
      })
    } else if (Array.isArray(slide.bullets) && slide.bullets.length > 0) {
      const text = slide.bullets
        .filter((line) => typeof line === 'string')
        .map((line) => ({ text: line, options: { bullet: true, breakLine: true } }))
      if (text.length > 0) s.addText(text, { ...BODY_OPTS })
    }

    if (slide.notes?.trim()) s.addNotes(slide.notes.trim())
  })

  // pptxgenjs types `write` loosely; nodebuffer output is a real Buffer.
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer)
}
