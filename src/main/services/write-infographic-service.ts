import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalPath, normalizePathSeparators, resolveTargetPathWithinWorkspace } from './workspace-paths'
import {
  getModelProviderSettings,
  isClaude360ProviderId,
  normalizeWriteSettings,
  type AppSettingsV1,
  type WriteSettingsPatchV1
} from '../../shared/app-settings'
import { sameClaude360Group } from '../../shared/claude360'
import {
  resolveImageSizeValue,
  type Claude360CanvasImage,
  type Claude360ImageEditPayload,
  type Claude360ImageGeneratePayload,
  type Claude360ImageResult,
  type Claude360ImageSize
} from '../../shared/claude360-canvas'
import {
  WRITE_DESIGN_DRAFT_DEFAULT_PROMPT,
  WRITE_INFOGRAPHIC_DEFAULT_PROMPT,
  WRITE_INFOGRAPHIC_MAX_TEXT_CHARS,
  type WriteInfographicKind,
  type WriteInfographicRequest,
  type WriteInfographicResult
} from '../../shared/write-infographic'
import { detectImage } from '../../../kun/src/attachments/attachment-store.js'

// Matches WORKSPACE_IMAGE_DIR in workspace-files.ts so infographics land in
// the same workspace-level folder as pasted images.
const INFOGRAPHIC_IMAGE_DIR = 'img'
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
// Portrait reads best for infographics (768x1024); design mockups read best in landscape (1024x768).
const KIND_SIZE_PRESET: Record<WriteInfographicKind, string> = {
  infographic: 'vertical',
  design: 'classic'
}
const KIND_FILE_PREFIX: Record<WriteInfographicKind, string> = {
  infographic: 'infographic',
  design: 'design'
}
const KIND_DEFAULT_PROMPT: Record<WriteInfographicKind, string> = {
  infographic: WRITE_INFOGRAPHIC_DEFAULT_PROMPT,
  design: WRITE_DESIGN_DRAFT_DEFAULT_PROMPT
}

type Claude360CanvasPort = {
  generateImages(request: Claude360ImageGeneratePayload): Promise<Claude360ImageResult>
  editImage(request: Claude360ImageEditPayload): Promise<Claude360ImageResult>
}

export function isWriteInfographicConfigured(settings: AppSettingsV1): boolean {
  return resolveClaude360ImageModel(settings) !== null
}

export function buildWriteInfographicPrompt(
  text: string,
  customPrompt = '',
  kind: WriteInfographicKind = 'infographic',
  options: { maxPromptChars?: number } = {}
): string {
  const clipped = text.trim().slice(0, WRITE_INFOGRAPHIC_MAX_TEXT_CHARS)
  const prefix = customPrompt.trim() || KIND_DEFAULT_PROMPT[kind]
  const maxPromptChars = options.maxPromptChars
  if (typeof maxPromptChars === 'number' && Number.isFinite(maxPromptChars) && maxPromptChars > 0) {
    return fitPromptToMaxChars(prefix, clipped, maxPromptChars)
  }
  return `${prefix}\n\n${clipped}`
}

function fitPromptToMaxChars(prefix: string, text: string, maxChars: number): string {
  const separator = '\n\n'
  const max = Math.max(1, Math.floor(maxChars))
  const fittedPrefix = prefix.slice(0, Math.max(0, max - separator.length)).trimEnd()
  const textBudget = Math.max(0, max - fittedPrefix.length - separator.length)
  const fittedText = text.slice(0, textBudget).trimEnd()
  return fittedText ? `${fittedPrefix}${separator}${fittedText}` : fittedPrefix
}

async function readReferenceImage(
  workspaceRoot: string,
  rawPath: string | undefined
): Promise<{ image?: { name: string; mimeType: string; data: Buffer }; error?: string }> {
  const input = rawPath?.trim()
  if (!input) return {}

  const absolutePath = isAbsolute(input) ? resolve(input) : resolve(workspaceRoot, input)
  const rel = relative(workspaceRoot, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    return { error: 'reference image must be inside the write workspace' }
  }

  let data: Buffer
  try {
    data = await readFile(absolutePath)
  } catch {
    return { error: 'reference image not found' }
  }
  if (data.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return { error: `reference image exceeds ${MAX_REFERENCE_IMAGE_BYTES} byte limit` }
  }
  const detected = detectImage(data)
  if (!detected || !REFERENCE_MIME_TYPES.has(detected.mimeType)) {
    return { error: 'reference image must be png, jpeg, or webp' }
  }
  return {
    image: {
      name: basename(absolutePath),
      mimeType: detected.mimeType,
      data
    }
  }
}

function resolveClaude360ImageModel(settings: AppSettingsV1): { model: string } | null {
  const selectedGroup = ((settings as { claude360?: { selectedImageGroup?: string } }).claude360?.selectedImageGroup ?? '').trim()
  if (!selectedGroup) return null

  const provider = getModelProviderSettings(settings).providers.find((profile) =>
    isClaude360ProviderId(profile.id) &&
    sameClaude360Group(claude360ProfileGroup(profile), selectedGroup)
  )
  const model = provider?.image?.models.find((item) => item.trim())?.trim()
  return model ? { model } : null
}

function claude360ProfileGroup(profile: { id: string; name: string }): string {
  const name = profile.name.trim()
  if (name) return name
  const id = profile.id.trim()
  const lower = id.toLowerCase()
  if (lower.startsWith('claude360:')) return id.slice('claude360:'.length)
  if (lower.startsWith('claude360-')) return id.slice('claude360-'.length)
  return id
}

function imageSizeForKind(kind: WriteInfographicKind): Claude360ImageSize {
  return resolveImageSizeValue(KIND_SIZE_PRESET[kind], '1K')
}

function referenceImageDataUrl(image: { mimeType: string; data: Buffer }): string {
  return `data:${image.mimeType};base64,${image.data.toString('base64')}`
}

async function readCanvasImage(image: Claude360CanvasImage): Promise<{ data: Buffer; mimeType: string }> {
  if (image.b64Json?.trim()) {
    return {
      data: Buffer.from(image.b64Json.trim(), 'base64'),
      mimeType: image.mimeType || 'image/png'
    }
  }
  if (image.url?.trim()) {
    const response = await fetch(image.url)
    if (!response.ok) {
      throw new Error(`image download failed with status ${response.status}`)
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType: contentType || image.mimeType || 'image/png'
    }
  }
  throw new Error('image generation returned an empty image')
}

export async function requestWriteInfographic(
  settings: AppSettingsV1,
  request: WriteInfographicRequest,
  options: { canvas?: Claude360CanvasPort } = {}
): Promise<WriteInfographicResult> {
  const imageGeneration = resolveClaude360ImageModel(settings)
  if (!imageGeneration || !options.canvas) {
    return { ok: false, message: 'image generation provider is not configured' }
  }

  const text = request.text.trim()
  if (!text) return { ok: false, message: 'selection text is empty' }

  const workspaceRoot = resolve(request.workspaceRoot)
  const filePath = resolve(request.filePath)
  const relativeToRoot = relative(workspaceRoot, filePath)
  if (!relativeToRoot || relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return { ok: false, message: 'document must be inside the write workspace' }
  }

  const kind: WriteInfographicKind = request.kind ?? 'infographic'
  const canvas = options.canvas
  const size = imageSizeForKind(kind)

  const selectionAssist = normalizeWriteSettings(
    (settings as { write?: WriteSettingsPatchV1 }).write
  ).selectionAssist
  const customPrompt = kind === 'design'
    ? selectionAssist.designDraftPrompt
    : selectionAssist.infographicPrompt
  const reference = await readReferenceImage(workspaceRoot, request.referenceImagePath)
  if (reference.error) return { ok: false, message: reference.error }

  let image: { data: Buffer; mimeType: string }
  try {
    const generationRequest = {
      prompt: buildWriteInfographicPrompt(text, customPrompt, kind),
      model: imageGeneration.model.trim(),
      ...(size && size !== 'auto' ? { size } : {})
    }
    const result = reference.image
      ? await canvas.editImage({ ...generationRequest, image: referenceImageDataUrl(reference.image) })
      : await canvas.generateImages(generationRequest)
    if (!result.ok) return { ok: false, message: result.message }
    image = await readCanvasImage(result.images[0])
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  const ext = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const fileName = `${KIND_FILE_PREFIX[kind]}-${stamp}-${randomBytes(2).toString('hex')}.${ext}`
  let absolutePath: string
  let markdownPath: string
  try {
    const imageDirSetting = request.imageDir?.trim() || INFOGRAPHIC_IMAGE_DIR
    const imageDir = await resolveTargetPathWithinWorkspace(imageDirSetting, workspaceRoot)
    await mkdir(imageDir, { recursive: true })
    absolutePath = join(imageDir, fileName)
    await writeFile(absolutePath, image.data)
    // imageDir is canonicalized (symlinks resolved), so derive the document
    // directory from the same canonical root to keep the relative link clean.
    // dirname(imageDir) only equals the root for single-segment dirs, so
    // canonicalize the root itself (covers nested dirs like the per-
    // requirement '.kunsdd/requirements/<id>/img').
    const canonicalRoot = await canonicalPath(workspaceRoot)
    const documentDir = join(canonicalRoot, dirname(relativeToRoot))
    markdownPath = normalizePathSeparators(relative(documentDir, absolutePath))
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  return {
    ok: true,
    relativePath: markdownPath,
    absolutePath,
    fileName
  }
}
