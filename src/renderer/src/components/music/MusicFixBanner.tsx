import type { ReactElement } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { MusicAccess } from '../../music/music-workbench-actions'

type TFn = (key: string, opts?: Record<string, unknown>) => string

type Props = {
  access: MusicAccess | null
  onOpenMy: () => void
  t: TFn
}

// 未登录 / 无 music 分组时的「去我的页修复」入口（纯展示）。
// access 为 null（探测中）或权限齐全时不渲染。
export function MusicFixBanner({ access, onOpenMy, t }: Props): ReactElement | null {
  if (access === null) return null
  if (access.loggedIn && access.hasMusicGroup) return null
  const message = !access.loggedIn ? t('musicNeedsLogin') : t('musicNeedsGroup')
  return (
    <div
      data-testid="music-fix-banner"
      className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
        {message}
      </span>
      <button
        type="button"
        onClick={onOpenMy}
        className="shrink-0 rounded-lg border border-amber-400 bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-amber-700 shadow-sm transition hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-500/10"
      >
        {t('musicGoToMy')}
      </button>
    </div>
  )
}
