import type { ReactElement } from 'react'
import { Boxes, Layers } from 'lucide-react'
import type { Claude360ModelCache } from '@shared/app-settings-claude360'

type Translate = (key: string, params?: Record<string, unknown>) => string

// 分组与模型 / 倍率展示。
// modelCache 只带 groups / models;倍率若可得则由 groupRatios 注入
// (group -> 倍率),缺失时展示占位,不臆造数值。
export function MyModelGroupsTable({
  modelCache,
  groupRatios,
  t
}: {
  modelCache: Claude360ModelCache | null
  groupRatios?: Record<string, number>
  t: Translate
}): ReactElement {
  const groups = modelCache?.groups ?? []
  const models = modelCache?.models ?? []
  return (
    <div className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ds-ink">
        <Layers className="h-4 w-4" strokeWidth={1.75} />
        {t('myModelGroups')}
      </h2>

      {groups.length === 0 && models.length === 0 ? (
        <p className="mt-4 text-[13px] text-ds-faint">{t('myNoModels')}</p>
      ) : (
        <>
          <div className="mt-4">
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
              {t('myGroupsLabel')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {groups.map((group) => {
                const ratio = groupRatios?.[group]
                return (
                  <span
                    key={group}
                    className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-main px-3 py-1 text-[12.5px] text-ds-ink"
                  >
                    {group}
                    <span className="text-[11.5px] text-ds-faint">
                      {t('myRatio')}: {typeof ratio === 'number' ? `×${ratio}` : '—'}
                    </span>
                  </span>
                )
              })}
            </div>
          </div>

          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
              <Boxes className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('myModelsLabel')} · {models.length}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {models.map((model) => (
                <span
                  key={model}
                  className="inline-flex items-center rounded-md border border-ds-border-muted bg-ds-main px-2 py-0.5 font-mono text-[11.5px] text-ds-muted"
                >
                  {model}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
