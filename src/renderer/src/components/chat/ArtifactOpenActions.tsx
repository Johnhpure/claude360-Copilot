import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, FolderOpen } from 'lucide-react'
import { extractArtifactPaths } from '../../lib/artifact-paths'

/**
 * 助手报出成品文件后，在气泡下面给一条「打开 / 打开目录」的快捷入口。
 *
 * PPT/Word 这类产物由 skill 通过 bash 跑脚本生成，运行时不会把它们登记成
 * `meta.generatedFiles`，所以 `GeneratedFilesPanel` 看不到；只能从助手自己
 * 报出的绝对路径来认。
 */
export function ArtifactOpenActions({ text }: { text: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const [failed, setFailed] = useState<string | null>(null)
  const artifacts = useMemo(() => extractArtifactPaths(text), [text])

  if (artifacts.length === 0) return null

  // `system` 交给系统默认应用（PowerPoint / Keynote / 预览），而不是用户偏好的
  // 代码编辑器——没人想用 VS Code 打开 .pptx。`finder` 走 showItemInFolder。
  //
  // 故意不传 workspaceRoot：传了会触发工作区边界校验，而 PPT 项目未必在工作区
  // 内——打包版的 skill 装在 userData 下，它自带的 projects/ 就在工作区外。
  // 路径本来就是绝对路径，省掉 workspaceRoot 时 resolveOpenTargetPath 直接放行。
  const open = async (path: string, editorId: 'system' | 'finder'): Promise<void> => {
    setFailed(null)
    if (typeof window === 'undefined' || typeof window.kunGui?.openEditorPath !== 'function') {
      setFailed(path)
      return
    }
    try {
      const result = await window.kunGui.openEditorPath({ path, editorId })
      if (!result.ok) setFailed(path)
    } catch {
      // 文件可能已被移走或删除；只提示，不抛。
      setFailed(path)
    }
  }

  return (
    <div className="mt-2 flex min-w-0 flex-col gap-1.5">
      {artifacts.map((artifact) => (
        <div
          key={artifact.path}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-ds-subtle bg-ds-surface px-2.5 py-1.5"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ds-ink" title={artifact.path}>
            {artifact.name}
          </span>
          <button
            type="button"
            onClick={() => void open(artifact.path, 'system')}
            className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('artifactOpen')}
          </button>
          <button
            type="button"
            onClick={() => void open(artifact.path, 'finder')}
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            title={t('artifactRevealInFolder')}
            aria-label={t('artifactRevealInFolder')}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
      {failed ? <div className="text-[11.5px] text-ds-faint">{t('artifactOpenFailed')}</div> : null}
    </div>
  )
}
