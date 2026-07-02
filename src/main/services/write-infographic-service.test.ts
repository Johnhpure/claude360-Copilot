import { mkdtempSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings'
import type {
  Claude360ImageEditPayload,
  Claude360ImageGeneratePayload,
  Claude360ImageResult
} from '../../shared/claude360-canvas'
import { buildWriteInfographicPrompt, requestWriteInfographic } from './write-infographic-service'

let workspace: string
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function settingsWithClaude360Image(overrides: { selectedImageGroup?: string; model?: string } = {}): AppSettingsV1 {
  const group = overrides.selectedImageGroup ?? 'image-group'
  const model = overrides.model ?? 'test-image-model'
  return {
    claude360: {
      selectedImageGroup: group,
      baseUrl: 'https://claude360.xyz'
    },
    provider: {
      providers: group
        ? [
            {
              id: `claude360:${group}`,
              name: group,
              apiKey: '',
              apiKeyRef: 'claude360:api-key:7',
              baseUrl: 'https://claude360.xyz',
              models: [model],
              modelProfiles: {},
              image: {
                protocol: 'openai-images',
                baseUrl: 'https://claude360.xyz',
                models: [model]
              }
            }
          ]
        : []
    }
  } as unknown as AppSettingsV1
}

type FakeCanvas = {
  edits: Claude360ImageEditPayload[]
  requests: Claude360ImageGeneratePayload[]
  generateImages(request: Claude360ImageGeneratePayload): Promise<Claude360ImageResult>
  editImage(request: Claude360ImageEditPayload): Promise<Claude360ImageResult>
}

function fakeCanvas(): FakeCanvas {
  const requests: Claude360ImageGeneratePayload[] = []
  const edits: Claude360ImageEditPayload[] = []
  return {
    edits,
    requests,
    async generateImages(request) {
      requests.push(request)
      return {
        ok: true,
        images: [{
          id: 'img-1',
          source: 'base64',
          b64Json: Buffer.from('fake-png-bytes').toString('base64'),
          mimeType: 'image/png',
          prompt: request.prompt,
          model: request.model,
          createdAt: '2026-07-02T00:00:00.000Z'
        }]
      }
    },
    async editImage(request) {
      edits.push(request)
      return {
        ok: true,
        images: [{
          id: 'img-edit',
          source: 'base64',
          b64Json: Buffer.from('fake-edited-png-bytes').toString('base64'),
          mimeType: 'image/png',
          prompt: request.prompt,
          model: request.model,
          createdAt: '2026-07-02T00:00:00.000Z'
        }]
      }
    }
  }
}

function failingCanvas(message: string): FakeCanvas {
  return {
    edits: [],
    requests: [],
    async generateImages(request) {
      this.requests.push(request)
      return { ok: false, message }
    },
    async editImage(request) {
      this.edits.push(request)
      return { ok: false, message }
    }
  }
}

describe('write infographic service', () => {
  beforeEach(() => {
    // realpath: macOS tmpdir lives behind a /var -> /private/var symlink and
    // the service canonicalizes workspace paths the same way.
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'write-infographic-')))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('rejects when no Claude360 image group is selected', async () => {
    const result = await requestWriteInfographic(settingsWithClaude360Image({ selectedImageGroup: '' }), {
      text: 'some text',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace
    })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not configured') })
  })

  it('rejects documents outside the write workspace', async () => {
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: 'some text',
      filePath: '/tmp/elsewhere/doc.md',
      workspaceRoot: workspace
    }, { canvas: fakeCanvas() })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('inside the write workspace') })
  })

  it('saves the infographic into the workspace img folder and returns a markdown-ready path', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: '季度营收增长 25%，主要来自海外市场。',
      filePath: join(workspace, 'notes', 'report.md'),
      workspaceRoot: workspace
    }, { canvas: client })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.relativePath).toMatch(/^\.\.\/img\/infographic-\d{14}-[0-9a-f]{4}\.png$/)
    expect(result.absolutePath).toBe(join(workspace, 'img', result.fileName))
    expect(existsSync(result.absolutePath)).toBe(true)
    expect(readFileSync(result.absolutePath, 'utf8')).toBe('fake-png-bytes')

    expect(client.requests).toHaveLength(1)
    expect(client.requests[0].model).toBe('test-image-model')
    expect(client.requests[0].size).toBe('768x1024')
    expect(client.requests[0].prompt).toContain('季度营收增长 25%')
    expect(client.requests[0].prompt).toContain('infographic')
  })

  it('links the image without ../ when the document sits at the workspace root', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: 'root-level document',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace
    }, { canvas: client })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.relativePath).toMatch(/^img\/infographic-\d{14}-[0-9a-f]{4}\.png$/)
    expect(result.absolutePath).toBe(join(workspace, 'img', result.fileName))
  })

  it('uses the Claude360 image group model from settings', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image({ model: 'gpt-image-2' }), {
      text: 'model selection content',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace
    }, { canvas: client })

    expect(result.ok).toBe(true)
    expect(client.requests[0].model).toBe('gpt-image-2')
  })

  it('surfaces provider failures as error results', async () => {
    const failingClient = failingCanvas('HTTP 400: unsupported size')
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: 'some text',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace
    }, { canvas: failingClient })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('unsupported size') })
  })

  it('clips overlong selections in the prompt', () => {
    const prompt = buildWriteInfographicPrompt('x'.repeat(10_000))
    expect(prompt.length).toBeLessThan(7_000)
  })

  it('can fit prompts inside an explicit prompt limit', () => {
    const prompt = buildWriteInfographicPrompt(
      `核心结论：${'增长、留存、转化、复购、风险。'.repeat(300)}`,
      '',
      'infographic',
      { maxPromptChars: 1500 }
    )
    expect(prompt.length).toBeLessThanOrEqual(1500)
    expect(prompt).toContain('polished infographic poster')
    expect(prompt).toContain('核心结论')
  })

  it('uses a custom prompt prefix when provided', () => {
    const prompt = buildWriteInfographicPrompt('内容', '请生成手绘风格的信息图。')
    expect(prompt).toBe('请生成手绘风格的信息图。\n\n内容')
  })

  it('falls back to the default prefix for blank custom prompts', () => {
    const prompt = buildWriteInfographicPrompt('content', '   ')
    expect(prompt).toContain('infographic')
  })

  it('sends the configured write.selectionAssist.infographicPrompt to the provider', async () => {
    const client = fakeCanvas()
    const settings = {
      ...settingsWithClaude360Image(),
      write: {
        selectionAssist: {
          infographicPrompt: '用赛博朋克风格画一张信息图。',
          quickActions: []
        }
      }
    } as unknown as AppSettingsV1
    const result = await requestWriteInfographic(settings, {
      text: '季度营收增长 25%',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace
    }, { canvas: client })

    expect(result.ok).toBe(true)
    expect(client.requests[0].prompt).toBe('用赛博朋克风格画一张信息图。\n\n季度营收增长 25%')
  })

  it('writes into a nested imageDir and keeps the relative link clean', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: '需求：支持扫码登录。',
      filePath: join(workspace, '.kunsdd', 'draft', 'dc040c2d', 'requirement.md'),
      workspaceRoot: workspace,
      imageDir: '.kunsdd/img',
      kind: 'design'
    }, { canvas: client })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.relativePath).toMatch(/^\.\.\/\.\.\/img\/design-\d{14}-[0-9a-f]{4}\.png$/)
    expect(result.absolutePath).toBe(join(workspace, '.kunsdd', 'img', result.fileName))
    expect(existsSync(result.absolutePath)).toBe(true)
  })

  it('uses the landscape default size and design prompt for kind=design', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: '需求内容',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace,
      kind: 'design'
    }, { canvas: client })

    expect(result.ok).toBe(true)
    expect(client.requests[0].size).toBe('1024x768')
    expect(client.requests[0].prompt).toContain('UI design mockup')
    expect(client.requests[0].prompt).not.toContain('infographic')
  })

  it('uses selected reference images for design drafts', async () => {
    const client = fakeCanvas()
    const referencePath = join(workspace, '.kunsdd', 'requirements', 'draft-1', 'img', 'source.png')
    mkdirSync(dirname(referencePath), { recursive: true })
    writeFileSync(referencePath, PNG_BYTES)

    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: '根据参考图重绘一个更精致的旅行社区首页。',
      filePath: join(workspace, '.kunsdd', 'requirements', 'draft-1', 'requirement.md'),
      workspaceRoot: workspace,
      imageDir: '.kunsdd/requirements/draft-1/img',
      kind: 'design',
      referenceImagePath: referencePath
    }, { canvas: client })

    expect(result.ok).toBe(true)
    expect(client.requests).toHaveLength(0)
    expect(client.edits).toHaveLength(1)
    expect(client.edits[0].image).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`)
    expect(client.edits[0].prompt).toContain('旅行社区首页')
    if (!result.ok) return
    expect(result.relativePath).toMatch(/^img\/design-\d{14}-[0-9a-f]{4}\.png$/)
    expect(readFileSync(result.absolutePath, 'utf8')).toBe('fake-edited-png-bytes')
  })

  it('prefers write.selectionAssist.designDraftPrompt for kind=design', async () => {
    const client = fakeCanvas()
    const settings = {
      ...settingsWithClaude360Image(),
      write: {
        selectionAssist: {
          infographicPrompt: '信息图提示词不该被用到。',
          designDraftPrompt: '画一张移动端高保真设计稿。',
          quickActions: []
        }
      }
    } as unknown as AppSettingsV1
    const result = await requestWriteInfographic(settings, {
      text: '扫码登录需求',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace,
      kind: 'design'
    }, { canvas: client })

    expect(result.ok).toBe(true)
    expect(client.requests[0].prompt).toBe('画一张移动端高保真设计稿。\n\n扫码登录需求')
  })

  it('rejects an imageDir that escapes the workspace', async () => {
    const client = fakeCanvas()
    const result = await requestWriteInfographic(settingsWithClaude360Image(), {
      text: 'some text',
      filePath: join(workspace, 'doc.md'),
      workspaceRoot: workspace,
      imageDir: '../outside'
    }, { canvas: client })

    expect(result.ok).toBe(false)
    expect(existsSync(join(workspace, '..', 'outside'))).toBe(false)
  })
})
