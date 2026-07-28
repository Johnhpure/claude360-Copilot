import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { LocalTool } from './local-tool-host.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import { resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { assertCanWritePath } from './sandbox-policy.js'
import type { DocxContent } from './office-gen-docx.js'
import type { XlsxContent } from './office-gen-xlsx.js'
import type { PptxContent } from './office-gen-pptx.js'

/**
 * `create_document` — generate a real Office file (docx / xlsx / pptx) in the
 * workspace and return it as a downloadable artifact.
 *
 * Deterministic, structured generation: the model supplies structured content
 * (headings/paragraphs/tables, sheets, slides) and this tool renders it with
 * the appropriate pure-JS library, writing a genuine binary file. The result
 * carries `files: [{ absolutePath, name, mimeType, byteSize }]`, which the GUI
 * turns into a download / open-in-editor card — no fabricated links, no ad-hoc
 * python scripts.
 *
 * docx supports `style: 'official'` for GB/T 9704-2012《党政机关公文格式》.
 */

const MIME_BY_FORMAT: Record<OfficeFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

type OfficeFormat = 'docx' | 'xlsx' | 'pptx'

const OFFICE_GEN_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: ['docx', 'xlsx', 'pptx'] },
    path: {
      type: 'string',
      description: 'Target file path within the workspace, e.g. reports/notice.docx'
    },
    style: {
      type: 'string',
      enum: ['normal', 'official'],
      description:
        "docx only. 'official' renders GB/T 9704-2012 党政机关公文格式 (仿宋三号正文, 版心边距, 成文日期右对齐, 版记). Default 'normal'."
    },
    content: {
      type: 'object',
      description:
        'Structured content. docx: { title?, blocks: [{type:heading|paragraph|list|table, ...}], official?:{sender,docNumber,recipient,date,signer,cc,printedBy} }. xlsx: { sheets:[{name,rows:[[cell]]}] }. pptx: { slides:[{title,bullets,notes,table}] }.'
    }
  },
  required: ['format', 'path', 'content'],
  additionalProperties: false
} as const

/** Ensure the file path carries the extension its format implies. */
function ensureExtension(rawPath: string, format: OfficeFormat): string {
  const current = extname(rawPath).toLowerCase()
  if (current === `.${format}`) return rawPath
  return `${rawPath}.${format}`
}

// Renderers pull in heavy pure-JS libraries (docx / exceljs / pptxgenjs). They
// are imported lazily inside execute() rather than at module top level: this
// tool is constructed during LocalToolHost's module-init (defaultLocalTools),
// and a static import chain into those libraries would deadlock that init with
// a circular-reference error. Lazy import also keeps startup cheap.
async function renderByFormat(
  format: OfficeFormat,
  style: string,
  content: Record<string, unknown>
): Promise<Buffer> {
  switch (format) {
    case 'docx': {
      if (style === 'official') {
        const { renderOfficialDocx } = await import('./office-gen-official-style.js')
        return renderOfficialDocx(content as DocxContent)
      }
      const { renderDocx } = await import('./office-gen-docx.js')
      return renderDocx(content as DocxContent)
    }
    case 'xlsx': {
      const { renderXlsx } = await import('./office-gen-xlsx.js')
      return renderXlsx(content as XlsxContent)
    }
    case 'pptx': {
      const { renderPptx } = await import('./office-gen-pptx.js')
      return renderPptx(content as PptxContent)
    }
  }
}

export function createOfficeGenLocalTool(): LocalTool {
  // Constructed as a plain LocalTool literal (not via LocalToolHost.defineTool)
  // to avoid a value import of local-tool-host.js. This tool is built during
  // that module's own init (defaultLocalTools), so a value dependency back into
  // it deadlocks module evaluation. policy/toolKind are set explicitly here,
  // which is all defineTool would have defaulted.
  return {
    name: 'create_document',
    description:
      'Generate a downloadable Office document (docx, xlsx, or pptx) in the workspace from structured content. ' +
      "For docx, pass style:'official' to produce a GB/T 9704-2012 中国党政机关公文格式 document. " +
      'Returns the created file as a downloadable artifact. Use this instead of writing scripts to produce Office files.',
    inputSchema: OFFICE_GEN_INPUT_SCHEMA,
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) =>
      withToolBoundary(async () => {
        const format = args.format
        if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') {
          return { output: { error: 'format must be one of: docx, xlsx, pptx' }, isError: true }
        }
        const rawPath = typeof args.path === 'string' ? args.path.trim() : ''
        if (!rawPath) {
          return { output: { error: 'path is required' }, isError: true }
        }
        const content =
          args.content && typeof args.content === 'object'
            ? (args.content as Record<string, unknown>)
            : null
        if (!content) {
          return { output: { error: 'content is required and must be an object' }, isError: true }
        }
        const style = typeof args.style === 'string' ? args.style : 'normal'

        const targetPath = ensureExtension(rawPath, format)
        const { absolutePath, relativePath } = await resolveWorkspacePath(targetPath, context)
        assertCanWritePath(absolutePath, context)

        const buffer = await renderByFormat(format, style, content)

        return withFileMutationQueue(absolutePath, async () => {
          await mkdir(dirname(absolutePath), { recursive: true })
          await writeFile(absolutePath, buffer)
          const name = basename(absolutePath)
          const usedOfficial = format === 'docx' && style === 'official'
          return {
            output: {
              path: absolutePath,
              relative_path: relativePath,
              bytes_written: buffer.byteLength,
              style: format === 'docx' ? (usedOfficial ? 'official' : 'normal') : undefined,
              // Consumed by kun-mapper extractToolGeneratedFiles → download card.
              files: [
                {
                  name,
                  absolutePath,
                  relativePath,
                  mimeType: MIME_BY_FORMAT[format],
                  byteSize: buffer.byteLength
                }
              ],
              ...(usedOfficial
                ? {
                    note: '已按 GB/T 9704 公文格式生成。字体显示依赖打开端是否安装 仿宋_GB2312 / 方正小标宋 等字体，缺失时 Word 会自动回退（版式保留，字形不同）。'
                  }
                : {})
            }
          }
        })
      })
  }
}
