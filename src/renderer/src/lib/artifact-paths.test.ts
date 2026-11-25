import { describe, expect, it } from 'vitest'
import { extractArtifactPaths } from './artifact-paths'

describe('extractArtifactPaths', () => {
  it('pulls the path out of the wrap-up line ppt-master actually writes', () => {
    // Verbatim shape from a real run.
    const text =
      '已完成 Git 版本控制入门演示文稿：\n\n' +
      '**PPTX 文件：** `/Users/me/work/projects/git_ppt169_20260830/exports/git_20260830_164625.pptx`'
    expect(extractArtifactPaths(text)).toEqual([
      {
        path: '/Users/me/work/projects/git_ppt169_20260830/exports/git_20260830_164625.pptx',
        name: 'git_20260830_164625.pptx'
      }
    ])
  })

  it('does not swallow the closing backtick', () => {
    const [artifact] = extractArtifactPaths('见 `/tmp/deck.pptx`')
    expect(artifact?.path).toBe('/tmp/deck.pptx')
  })

  it('handles Chinese directory names', () => {
    const [artifact] = extractArtifactPaths('文件在 /Users/me/项目/信息技术部述职/exports/汇报.pptx')
    expect(artifact?.path).toBe('/Users/me/项目/信息技术部述职/exports/汇报.pptx')
    expect(artifact?.name).toBe('汇报.pptx')
  })

  it('drops trailing sentence punctuation', () => {
    const [artifact] = extractArtifactPaths('已导出到 /tmp/deck.pptx。')
    expect(artifact?.path).toBe('/tmp/deck.pptx')
  })

  it('keeps several artifacts in the order they appear, de-duplicated', () => {
    const text =
      'PPTX: /tmp/a.pptx\nPDF: /tmp/a.pdf\n再说一次 PPTX: /tmp/a.pptx'
    expect(extractArtifactPaths(text).map((entry) => entry.path)).toEqual([
      '/tmp/a.pptx',
      '/tmp/a.pdf'
    ])
  })

  it('ignores intermediate build files', () => {
    // A PPT project is full of these; surfacing them would bury the real deliverable.
    const text = [
      '/tmp/p/design_spec.md',
      '/tmp/p/confirm_ui/recommendations.stage2.json',
      '/tmp/p/svg_final/01_intro.svg'
    ].join('\n')
    expect(extractArtifactPaths(text)).toEqual([])
  })

  it('ignores relative paths, which we cannot open reliably', () => {
    expect(extractArtifactPaths('见 exports/deck.pptx')).toEqual([])
  })

  it('recognises Windows paths', () => {
    const [artifact] = extractArtifactPaths('保存在 C:\\Users\\me\\Desktop\\deck.pptx')
    expect(artifact?.path).toBe('C:\\Users\\me\\Desktop\\deck.pptx')
    expect(artifact?.name).toBe('deck.pptx')
  })

  it('returns nothing for ordinary prose', () => {
    expect(extractArtifactPaths('我已经把这几页改好了，还需要调整吗？')).toEqual([])
    expect(extractArtifactPaths('')).toEqual([])
  })
})
