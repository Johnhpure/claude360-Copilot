import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  Check,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { Claude360TokenListItem, Claude360TokenPurpose } from '@shared/claude360'

// 「设置 → 分组及 Key」页(Master-Detail)。
// 把旧的「供应商」只读壳改造成:左列 = 从 claude360 拉取的模型分组,
// 右侧 = 该分组的可用模型 + 该分组下的 API Key 管理。
//
// 安全约束(与 MyPage 对齐):
//   - 明文 Key 默认不显示,列表只展示脱敏 maskedKey;
//   - reveal 走显式点击 + 60s TTL 自动隐藏;
//   - 复制后立即清除明文,不等 TTL。
//
// 所有 window.kunGui.* 调用都做存在性守卫,避免 preload bridge 缺失时崩溃。

type Translate = (key: string, params?: Record<string, unknown>) => string

// claude360GroupsList() 的分组项。
export type GroupSummary = {
  name: string
  recommended: boolean
  ratio?: number | null
  desc?: string
}

// purpose 筛选:'all' 合并去重全部分组;其余按 purpose 过滤。
export type GroupsPurposeFilter = 'all' | Claude360TokenPurpose

const PURPOSE_FILTERS: GroupsPurposeFilter[] = ['all', 'text', 'image', 'music']

const PURPOSE_FILTER_LABEL_KEYS: Record<GroupsPurposeFilter, string> = {
  all: 'groupsKeysFilterAll',
  text: 'groupsKeysFilterText',
  image: 'groupsKeysFilterImage',
  music: 'groupsKeysFilterMusic'
}

// 每组懒加载模型 chips,超过这个数量折叠成「+N 展开全部」。
const MODEL_CHIP_LIMIT = 10

// reveal 明文只在 renderer 短暂驻留:60s TTL 后自动清除(与 MyPage 一致)。
const REVEAL_TTL_MS = 60_000

function formatRatio(ratio: number | null | undefined): string {
  if (ratio == null) return '1.0'
  return String(ratio)
}

// 「全部」筛选合并三类分组并按 name 去重,保持首次出现顺序。
export function flattenGroups(
  byPurpose: Record<Claude360TokenPurpose, GroupSummary[]> | null,
  filter: GroupsPurposeFilter
): GroupSummary[] {
  if (!byPurpose) return []
  if (filter !== 'all') return byPurpose[filter] ?? []
  const seen = new Set<string>()
  const merged: GroupSummary[] = []
  for (const purpose of ['text', 'image', 'music'] as Claude360TokenPurpose[]) {
    for (const group of byPurpose[purpose] ?? []) {
      if (seen.has(group.name)) continue
      seen.add(group.name)
      merged.push(group)
    }
  }
  return merged
}

function RecommendedBadge({ label }: { label: string }): ReactElement {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/70 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-300">
      <Check className="h-2.5 w-2.5" strokeWidth={2.6} />
      {label}
    </span>
  )
}

function RatioPill({
  ratio,
  className = ''
}: {
  ratio: number | null | undefined
  className?: string
}): ReactElement {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-accent/15 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-accent ${className}`}
    >
      ×{formatRatio(ratio)}
    </span>
  )
}

function DetailPanelSection({
  title,
  count,
  action,
  children
}: {
  title: ReactNode
  count?: number
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="overflow-hidden rounded-2xl border border-ds-border bg-ds-card">
      <div className="flex items-center justify-between gap-2 border-b border-ds-border-muted px-4 py-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
          {title}
          {typeof count === 'number' ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ds-main px-1.5 text-[11px] font-semibold text-ds-faint">
              {count}
            </span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

// ── 分组下的可用模型 chips(懒加载) ──────────────────────────────
function GroupModelsSection({
  groupName,
  models,
  loading,
  error,
  onRetry,
  t
}: {
  groupName: string
  models: string[] | undefined
  loading: boolean
  error: string | null
  onRetry: () => void
  t: Translate
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  // 切换分组时收起「展开全部」,避免旧分组的展开态带到新分组。
  useEffect(() => {
    setExpanded(false)
  }, [groupName])

  const total = models?.length ?? 0
  const overflow = total - MODEL_CHIP_LIMIT
  const shown = models ? (expanded ? models : models.slice(0, MODEL_CHIP_LIMIT)) : []

  return (
    <DetailPanelSection
      title={
        <>
          <Cpu className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('groupsKeysModelsTitle')}
        </>
      }
      count={models ? total : undefined}
    >
      <div className="px-4 py-3.5">
        {loading ? (
          <div className="flex items-center gap-2 text-[12.5px] text-ds-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
            {t('groupsKeysModelsLoading')}
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-600 dark:text-red-300">
            <span>{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-ds-border bg-ds-card px-2 py-0.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('groupsKeysRetry')}
            </button>
          </div>
        ) : total === 0 ? (
          <p className="text-[12.5px] text-ds-faint">{t('groupsKeysModelsEmpty')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((model) => (
              <span
                key={model}
                className="inline-flex max-w-full items-center rounded-lg border border-ds-border-muted bg-ds-main px-2.5 py-1 font-mono text-[11.5px] text-ds-muted"
              >
                <span className="truncate">{model}</span>
              </span>
            ))}
            {!expanded && overflow > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="inline-flex items-center rounded-lg bg-accent/15 px-2.5 py-1 font-mono text-[11.5px] font-semibold text-accent transition hover:bg-accent/25"
              >
                {t('groupsKeysModelsExpand', { count: overflow })}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </DetailPanelSection>
  )
}

// ── 分组下的 API Key 表(纯展示,便于测试) ────────────────────────
export function GroupKeysTable({
  keys,
  revealed,
  creating,
  onReveal,
  onCopy,
  onDelete,
  onCreate,
  t
}: {
  keys: Claude360TokenListItem[]
  /** tokenId -> 已 reveal 的明文;未在其中一律脱敏。 */
  revealed: Record<number, string>
  creating: boolean
  onReveal: (tokenId: number) => void
  onCopy: (tokenId: number, value: string) => void
  onDelete: (tokenId: number) => void
  onCreate: () => void
  t: Translate
}): ReactElement {
  const createButton = (
    <button
      type="button"
      onClick={onCreate}
      disabled={creating}
      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {creating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
      ) : (
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      {creating ? t('groupsKeysCreating') : t('groupsKeysCreate')}
    </button>
  )

  return (
    <DetailPanelSection
      title={
        <>
          <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('groupsKeysKeysTitle')}
        </>
      }
      count={keys.length}
      action={createButton}
    >
      {keys.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
          <KeyRound className="h-5 w-5 text-ds-faint opacity-60" strokeWidth={1.6} />
          <p className="text-[13px] font-medium text-ds-muted">{t('groupsKeysKeysEmptyTitle')}</p>
          <p className="text-[12px] text-ds-faint">{t('groupsKeysKeysEmptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-ds-main text-[11px] uppercase tracking-wide text-ds-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t('groupsKeysColName')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('groupsKeysColKey')}</th>
                <th className="px-4 py-2.5 font-semibold">{t('groupsKeysColQuota')}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t('groupsKeysColActions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((token) => {
                const plain = revealed[token.id]
                const isRevealed = typeof plain === 'string' && plain.length > 0
                return (
                  <tr key={token.id} className="border-t border-ds-border-muted transition hover:bg-ds-hover">
                    <td className="px-4 py-2.5 font-medium text-ds-ink">{token.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-ds-muted">
                      {isRevealed ? plain : token.maskedKey}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${
                        token.unlimitedQuota
                          ? 'font-semibold text-emerald-600 dark:text-emerald-300'
                          : 'text-ds-muted'
                      }`}
                    >
                      {token.unlimitedQuota
                        ? t('groupsKeysQuotaUnlimited')
                        : token.remainQuota.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          aria-label={isRevealed ? t('groupsKeysHide') : t('groupsKeysReveal')}
                          title={isRevealed ? t('groupsKeysHide') : t('groupsKeysReveal')}
                          onClick={() => onReveal(token.id)}
                          className="rounded-md border border-ds-border px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        >
                          {isRevealed ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                          )}
                        </button>
                        {isRevealed ? (
                          <button
                            type="button"
                            aria-label={t('groupsKeysCopy')}
                            title={t('groupsKeysCopy')}
                            onClick={() => onCopy(token.id, plain)}
                            className="rounded-md border border-ds-border px-2 py-1 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          >
                            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={t('groupsKeysDelete')}
                          title={t('groupsKeysDelete')}
                          onClick={() => onDelete(token.id)}
                          className="rounded-md border border-red-200/70 px-2 py-1 text-red-600 transition hover:bg-red-50 dark:border-red-900/70 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </DetailPanelSection>
  )
}

// ── 左列分组列表项 ─────────────────────────────────────────────
export function GroupListItem({
  group,
  keyCount,
  selected,
  onSelect,
  t
}: {
  group: GroupSummary
  keyCount: number
  selected: boolean
  onSelect: () => void
  t: Translate
}): ReactElement {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      className={`relative block w-full rounded-xl border px-3.5 py-2.5 pl-4 text-left transition ${
        selected
          ? 'border-ds-border bg-ds-card shadow-sm'
          : 'border-transparent hover:bg-ds-hover'
      }`}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full bg-accent"
        />
      ) : null}
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-ds-ink">{group.name}</span>
        {group.recommended ? <RecommendedBadge label={t('groupsKeysRecommended')} /> : null}
      </div>
      <div className="mt-1 flex items-center gap-2.5 text-[11.5px] text-ds-faint">
        <RatioPill ratio={group.ratio} />
        <span>{t('groupsKeysKeyCount', { count: keyCount })}</span>
      </div>
    </button>
  )
}

// ── 容器组件:数据加载 + 异步编排 ───────────────────────────────
export function GroupsKeysSection({ t }: { t: Translate }): ReactElement {
  const [groupsByPurpose, setGroupsByPurpose] =
    useState<Record<Claude360TokenPurpose, GroupSummary[]> | null>(null)
  const [tokens, setTokens] = useState<Claude360TokenListItem[]>([])
  const [purpose, setPurpose] = useState<GroupsPurposeFilter>('all')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [modelsByGroup, setModelsByGroup] = useState<Record<string, string[]>>({})
  const [modelsLoading, setModelsLoading] = useState<Record<string, boolean>>({})
  const [modelsError, setModelsError] = useState<Record<string, string | null>>({})
  const [revealed, setRevealed] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingKey, setCreatingKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortedRef = useRef(false)
  const revealTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    abortedRef.current = false
    return () => {
      abortedRef.current = true
      for (const timer of Object.values(revealTimersRef.current)) clearTimeout(timer)
      revealTimersRef.current = {}
    }
  }, [])

  const clearRevealed = useCallback((tokenId: number) => {
    const timer = revealTimersRef.current[tokenId]
    if (timer) {
      clearTimeout(timer)
      delete revealTimersRef.current[tokenId]
    }
    setRevealed((prev) => {
      if (!(tokenId in prev)) return prev
      const next = { ...prev }
      delete next[tokenId]
      return next
    })
  }, [])

  const clearAllRevealed = useCallback(() => {
    for (const timer of Object.values(revealTimersRef.current)) clearTimeout(timer)
    revealTimersRef.current = {}
    setRevealed({})
  }, [])

  const loadAll = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') {
      setLoading(false)
      return
    }
    try {
      const [groupsResult, tokensResult] = await Promise.all([
        window.kunGui.claude360GroupsList(),
        window.kunGui.claude360TokensList()
      ])
      if (abortedRef.current) return
      setGroupsByPurpose(groupsResult)
      setTokens(tokensResult)
      clearAllRevealed()
      setError(null)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!abortedRef.current) setLoading(false)
    }
  }, [clearAllRevealed])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const refreshTokens = useCallback(async () => {
    if (typeof window.kunGui === 'undefined') return
    const next = await window.kunGui.claude360TokensList()
    if (!abortedRef.current) {
      setTokens(next)
      clearAllRevealed()
    }
  }, [clearAllRevealed])

  const visibleGroups = useMemo(
    () => flattenGroups(groupsByPurpose, purpose),
    [groupsByPurpose, purpose]
  )

  // 当前分组失效(筛选切换/刷新后消失)时,回落到列表首项。
  useEffect(() => {
    if (visibleGroups.length === 0) {
      setSelectedGroup(null)
      return
    }
    setSelectedGroup((current) => {
      if (current && visibleGroups.some((group) => group.name === current)) return current
      return visibleGroups[0].name
    })
  }, [visibleGroups])

  const activeGroup = useMemo(
    () => visibleGroups.find((group) => group.name === selectedGroup) ?? null,
    [visibleGroups, selectedGroup]
  )

  const loadModels = useCallback(async (groupName: string, force = false) => {
    if (typeof window.kunGui === 'undefined') return
    if (!force && modelsByGroup[groupName]) return
    setModelsLoading((prev) => ({ ...prev, [groupName]: true }))
    setModelsError((prev) => ({ ...prev, [groupName]: null }))
    try {
      const { models } = await window.kunGui.claude360ModelsByGroup({ group: groupName })
      if (abortedRef.current) return
      setModelsByGroup((prev) => ({ ...prev, [groupName]: models }))
    } catch (e) {
      if (!abortedRef.current) {
        setModelsError((prev) => ({
          ...prev,
          [groupName]: e instanceof Error ? e.message : String(e)
        }))
      }
    } finally {
      if (!abortedRef.current) setModelsLoading((prev) => ({ ...prev, [groupName]: false }))
    }
  }, [modelsByGroup])

  // 选中分组变化时懒加载其模型(已缓存则跳过)。
  useEffect(() => {
    if (!selectedGroup) return
    void loadModels(selectedGroup)
  }, [selectedGroup, loadModels])

  const handleRefresh = useCallback(async () => {
    if (typeof window.kunGui === 'undefined' || refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      await window.kunGui.claude360ModelsRefresh()
      if (abortedRef.current) return
      // 刷新模型后清空模型缓存并重拉分组/Key,让倍率/描述与模型一并更新。
      setModelsByGroup({})
      setModelsError({})
      const [groupsResult, tokensResult] = await Promise.all([
        window.kunGui.claude360GroupsList(),
        window.kunGui.claude360TokensList()
      ])
      if (abortedRef.current) return
      setGroupsByPurpose(groupsResult)
      setTokens(tokensResult)
      clearAllRevealed()
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!abortedRef.current) setRefreshing(false)
    }
  }, [refreshing, clearAllRevealed])

  const handleReveal = useCallback(async (tokenId: number) => {
    if (typeof window.kunGui === 'undefined') return
    // 已 reveal 再点 = 隐藏(眼睛切换语义)。
    if (revealed[tokenId]) {
      clearRevealed(tokenId)
      return
    }
    try {
      const { key } = await window.kunGui.claude360TokensReveal({ tokenId })
      if (abortedRef.current) return
      setRevealed((prev) => ({ ...prev, [tokenId]: key }))
      const existing = revealTimersRef.current[tokenId]
      if (existing) clearTimeout(existing)
      revealTimersRef.current[tokenId] = setTimeout(() => clearRevealed(tokenId), REVEAL_TTL_MS)
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [revealed, clearRevealed])

  const handleCopy = useCallback((tokenId: number, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value)
    }
    // 复制后立即清除明文,不等 TTL。
    clearRevealed(tokenId)
  }, [clearRevealed])

  const handleDelete = useCallback(async (tokenId: number) => {
    if (typeof window.kunGui === 'undefined') return
    const confirmed =
      typeof window.kunGui.confirmDialog === 'function'
        ? await window.kunGui.confirmDialog({
            message: t('groupsKeysDeleteConfirmTitle'),
            detail: t('groupsKeysDeleteConfirmDetail'),
            confirmLabel: t('groupsKeysDeleteConfirmAction'),
            cancelLabel: t('groupsKeysCancel')
          })
        : true
    if (!confirmed) return
    try {
      await window.kunGui.claude360TokensDelete({ tokenId })
      if (abortedRef.current) return
      clearRevealed(tokenId)
      await refreshTokens()
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [t, clearRevealed, refreshTokens])

  const handleCreate = useCallback(async () => {
    if (typeof window.kunGui === 'undefined' || creatingKey || !activeGroup) return
    setCreatingKey(true)
    setError(null)
    try {
      // Key 名称用固定非本地化前缀,避免把界面语言写进后端持久数据(与 MyPage/token-service 对齐)。
      await window.kunGui.claude360TokensCreate({
        group: activeGroup.name,
        name: `Claude360 Copilot-${Date.now()}`
      })
      if (abortedRef.current) return
      await refreshTokens()
    } catch (e) {
      if (!abortedRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!abortedRef.current) setCreatingKey(false)
    }
  }, [creatingKey, activeGroup, refreshTokens])

  const keysForGroup = useCallback(
    (groupName: string) => tokens.filter((token) => token.group === groupName),
    [tokens]
  )

  const keyCountForGroup = useCallback(
    (groupName: string) => tokens.reduce((total, token) => (token.group === groupName ? total + 1 : total), 0),
    [tokens]
  )

  const activeGroupKeys = activeGroup ? keysForGroup(activeGroup.name) : []

  return (
    <section className="rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25">
      {/* 头部:标题 + 刷新 */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ds-border-muted px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Layers className="h-4.5 w-4.5" strokeWidth={1.9} />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-ds-ink">{t('groupsKeysTitle')}</h2>
            <p className="mt-0.5 text-[12px] text-ds-faint">{t('groupsKeysDesc')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            strokeWidth={1.9}
          />
          {t('groupsKeysRefresh')}
        </button>
      </div>

      {/* 筛选 segmented */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ds-border-muted px-5 py-2.5">
        <div
          role="tablist"
          aria-label={t('groupsKeysFilterAria')}
          className="inline-flex gap-0.5 rounded-full border border-ds-border-muted bg-ds-main p-0.5"
        >
          {PURPOSE_FILTERS.map((value) => {
            const active = purpose === value
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPurpose(value)}
                className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                  active
                    ? 'bg-ds-card text-ds-ink shadow-sm'
                    : 'text-ds-muted hover:text-ds-ink'
                }`}
              >
                {t(PURPOSE_FILTER_LABEL_KEYS[value])}
              </button>
            )
          })}
        </div>
        {!loading ? (
          <span className="text-[12px] text-ds-faint">
            {t('groupsKeysGroupCount', { count: visibleGroups.length })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-ds-border-muted bg-red-50 px-5 py-2.5 text-[12.5px] text-red-700 dark:bg-red-950/25 dark:text-red-200">
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded-md border border-red-200/70 bg-red-50 px-2 py-0.5 text-[12px] font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
          >
            {t('groupsKeysRetry')}
          </button>
        </div>
      ) : null}

      {/* Master-Detail */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 px-5 py-16 text-[13px] text-ds-faint">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
          {t('groupsKeysLoading')}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
          <Layers className="h-6 w-6 text-ds-faint opacity-60" strokeWidth={1.6} />
          <p className="text-[13px] font-medium text-ds-muted">{t('groupsKeysNoGroupsTitle')}</p>
          <p className="text-[12px] text-ds-faint">{t('groupsKeysNoGroupsHint')}</p>
        </div>
      ) : (
        <div className="grid gap-0 md:grid-cols-[240px_minmax(0,1fr)]">
          {/* 左列:分组 */}
          <nav
            aria-label={t('groupsKeysListAria')}
            className="flex max-h-[560px] flex-col gap-1 overflow-y-auto border-b border-ds-border-muted p-2.5 md:border-b-0 md:border-r"
          >
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
              {t('groupsKeysListLabel')}
            </div>
            {visibleGroups.map((group) => (
              <GroupListItem
                key={group.name}
                group={group}
                keyCount={keyCountForGroup(group.name)}
                selected={activeGroup?.name === group.name}
                onSelect={() => setSelectedGroup(group.name)}
                t={t}
              />
            ))}
          </nav>

          {/* 右侧:详情 */}
          <div className="max-h-[560px] overflow-y-auto p-5">
            {activeGroup ? (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex min-w-0 flex-nowrap items-center gap-2.5">
                    <h2 className="min-w-0 truncate text-[18px] font-semibold text-ds-ink">{activeGroup.name}</h2>
                    {activeGroup.recommended ? (
                      <RecommendedBadge label={t('groupsKeysRecommended')} />
                    ) : null}
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent/15 px-2.5 py-0.5 text-[12.5px] font-semibold tabular-nums text-accent">
                      {t('groupsKeysRatioLabel')} ×{formatRatio(activeGroup.ratio)}
                    </span>
                  </div>
                  {activeGroup.desc ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-ds-muted">{activeGroup.desc}</p>
                  ) : null}
                </div>

                <GroupModelsSection
                  groupName={activeGroup.name}
                  models={modelsByGroup[activeGroup.name]}
                  loading={Boolean(modelsLoading[activeGroup.name])}
                  error={modelsError[activeGroup.name] ?? null}
                  onRetry={() => void loadModels(activeGroup.name, true)}
                  t={t}
                />

                <GroupKeysTable
                  keys={activeGroupKeys}
                  revealed={revealed}
                  creating={creatingKey}
                  onReveal={(tokenId) => void handleReveal(tokenId)}
                  onCopy={handleCopy}
                  onDelete={(tokenId) => void handleDelete(tokenId)}
                  onCreate={() => void handleCreate()}
                  t={t}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
