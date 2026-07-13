import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, CornerUpLeft, Folder, FolderOpen, GitFork, RefreshCw, Settings } from 'lucide-react'
import type { ClawImChannelV1 } from '@shared/app-settings'
import { KunStateFigure } from './AnimatedWorkLogo'
import { InitialSessionUsageHeatmap } from './InitialSessionUsageHeatmap'
import { BrandHero } from './BrandHero'
import { CodeStarterDeck, ConversationStarterDeck } from './CodeStarterDeck'
import { buildRecentProjectItems } from './home-empty-state'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { isNoProjectWorkspace } from '../../lib/workspace-path'

/**
 * Empty / hero states rendered by `MessageTimeline` when there is no
 * turn content yet. Lifted out of the timeline component so the main
 * file can focus on rendering turns and scroll behaviour.
 */

function clawChannelDisplayName(
  channel: ClawImChannelV1 | null,
  fallback: string
): string {
  if (!channel) return fallback
  return (
    channel.agentProfile.name.trim()
    || channel.label.trim()
    || channel.agentProfile.description.trim()
    || fallback
  )
}

function ClawEmptyHero({
  channel,
  onSelectSuggestion
}: {
  channel: ClawImChannelV1 | null
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentName = clawChannelDisplayName(channel, t('clawEmptyHeroFallbackName'))
  void onSelectSuggestion
  const hasInboundConversation = Boolean(
    channel?.threadId.trim() ||
    channel?.conversations.some((conversation) => conversation.localThreadId.trim()) ||
    channel?.conversations.length ||
    channel?.remoteSession?.chatId?.trim()
  )

  return (
    <div className="ds-no-drag flex justify-center px-4 pb-6 pt-12 md:px-8 md:pt-16">
      <div className="w-full ds-chat-content-max-width rounded-[32px] border border-ds-border-muted bg-ds-card px-8 py-10 text-center shadow-[var(--c360-shadow-sm)] md:px-12 md:py-14">
        <div className="mx-auto max-w-[720px]">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] border border-ds-border-muted bg-ds-main text-accent">
            <KunStateFigure kind="greet" className="h-14 w-14" />
          </div>

          <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.055em] text-ds-ink md:text-[48px]">
            {t('clawEmptyHeroTitle', { name: agentName })}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ds-muted md:text-[16px]">
            {hasInboundConversation ? t('clawEmptyHeroSub') : t('clawEmptyHeroNeedsInbound')}
          </p>
        </div>
      </div>
    </div>
  )
}

function RuntimeWakeHero({
  runtimeError,
  onRetry,
  onOpenSettings
}: {
  runtimeError?: string | null
  onRetry: () => void
  onOpenSettings: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  // When the runtime probe has surfaced a specific error (e.g. port conflict,
  // missing API key, or unhealthy runtime), prefer a clear "cannot connect"
  // title and show the localized error message as the body. Otherwise fall
  // back to the generic "waking" hero. This addresses issue #78, where users
  // saw the "正在唤醒" title and assumed the app was still loading, never
  // noticing the port-conflict detail text below it.
  const trimmedError = runtimeError?.trim() ?? ''
  const hasError = trimmedError.length > 0
  const title = hasError ? t('runtimeErrorHeroTitle') : t('runtimeOfflineHeroTitle')
  const detail = hasError ? trimmedError : t('runtimeOfflineHeroSub')

  return (
    <div className="ds-runtime-wake-hero ds-no-drag px-6 pb-8 pt-12 text-center md:pt-16">
      {/* 启动/未就绪画面以动态文字品牌「Claude360 Copilot」替代 Logo 图片（需求二）*/}
      <BrandHero />

      <p className="text-[12px] font-semibold uppercase tracking-[0] text-accent">
        {t('runtimeOfflineHeroKicker')}
      </p>
      <h1 className="mt-2 max-w-[620px] text-[26px] font-semibold leading-tight tracking-[0] text-ds-ink md:text-[32px]">
        {title}
      </h1>
      <p className="mt-3 max-w-[620px] text-[15px] leading-7 text-ds-muted">
        {detail}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="ds-chip inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('retryConnection')}
        </button>
        <button
          type="button"
          className="ds-chip-muted inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('openSettings')}
        </button>
      </div>
    </div>
  )
}

/**
 * Code 首页就绪空态「开发者启动工作台」（07-13-code-home-workbench R1）。
 * 信息层级自上而下：收紧版 BrandHero → 工作台引导行（当前项目名大字 +
 * 引导语）→ 8 张快捷任务卡（CodeStarterDeck，点击经 onSelectSuggestion
 * 填充 composer 并聚焦）→ 内嵌的用量日历（默认折叠）。
 *
 * 项目名来自 chat-store `workspaceRoot` 的同步纯函数转换（零 IO 零异步）；
 * 路径/分支细节不在此重复展示——底部 composer 状态栏已有（design §1）。
 * 到达本组件时必有真实项目：未打开项目（空串/default_workspace）已由
 * 上游分流到 NoProjectWelcome（07-13-code-home-polish R2）。
 */
function CodeHomeWorkbench({
  workspaceRoot,
  onSelectSuggestion
}: {
  workspaceRoot: string
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const projectLabel = workspaceLabelFromPath(workspaceRoot)

  return (
    <div
      className="ds-code-home-workbench ds-no-drag mx-auto flex w-full min-w-0 items-center justify-center px-3 py-6 sm:px-5 sm:py-8"
      data-testid="code-home-workbench"
    >
      <div className="ds-chat-content-max-width flex w-full min-w-0 flex-col items-center">
        <BrandHero compact />

        <div className="ds-code-home-intro">
          <p className="ds-code-home-intro-kicker">{t('codeHomeProjectKicker')}</p>
          <h1 className="ds-code-home-intro-title" title={workspaceRoot}>
            {projectLabel}
          </h1>
          <p className="ds-code-home-intro-sub">{t('codeHomeIntroSub')}</p>
        </div>

        <div className="ds-code-home-deck w-full min-w-0">
          <CodeStarterDeck onSelect={(prompt) => onSelectSuggestion?.(prompt)} />
        </div>

        <div className="ds-code-home-usage w-full min-w-0">
          <InitialSessionUsageHeatmap embedded />
        </div>
      </div>
    </div>
  )
}

/**
 * 「未打开项目」空态（07-13-code-home-polish R2）：workspaceRoot 为空或指向
 * default_workspace（主进程兜底产物）时替代开发工作台。页面唯一品牌出现点是
 * BrandHero；主标题行动导向（打开项目），副文案明确区分「普通对话可直接输入」
 * 与「项目任务需先打开项目」。不渲染依赖项目上下文的开发卡与用量日历。
 */
function NoProjectWelcome({
  recentWorkspaceRoots,
  onPickWorkspace,
  onSelectWorkspaceRoot
}: {
  recentWorkspaceRoots: readonly string[]
  onPickWorkspace: () => void
  onSelectWorkspaceRoot?: (root: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  // 过滤默认工作区/对话目录/worktree 后的最近项目(最多 5 条,近似 MRU)。
  const recentItems = buildRecentProjectItems(recentWorkspaceRoots)

  return (
    <div
      className="ds-code-home-workbench ds-no-drag mx-auto flex w-full min-w-0 items-center justify-center px-3 py-6 sm:px-5 sm:py-8"
      data-testid="no-project-welcome"
    >
      <div className="ds-chat-content-max-width flex w-full min-w-0 flex-col items-center">
        <BrandHero compact />

        <div className="ds-code-home-intro">
          <h1 className="ds-code-home-intro-title">{t('noProjectTitle')}</h1>
          <p className="ds-code-home-intro-sub">{t('noProjectSub')}</p>
        </div>

        <button
          type="button"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--ds-accent)_22%,transparent)] transition hover:brightness-110"
          onClick={onPickWorkspace}
        >
          <FolderOpen className="h-4 w-4" strokeWidth={1.8} />
          {t('noProjectPickAction')}
        </button>

        {recentItems.length > 0 ? (
          <section className="mt-8 w-full max-w-[520px]">
            <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[0.02em] text-ds-faint">
              {t('noProjectRecentTitle')}
            </h2>
            <div className="mt-2.5 flex flex-col gap-2">
              {recentItems.map((item) => (
                <button
                  key={item.root}
                  type="button"
                  className="flex items-center gap-3 rounded-[14px] border border-ds-border bg-ds-card px-4 py-3 text-left shadow-[var(--c360-shadow-sm)] transition duration-[var(--motion-base)] hover:border-[color-mix(in_srgb,var(--ds-accent)_18%,transparent)] hover:bg-ds-elevated"
                  title={item.root}
                  onClick={() => onSelectWorkspaceRoot?.(item.root)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                    <Folder className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ds-ink">
                      {item.label}
                    </span>
                    {item.parentDir ? (
                      <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                        {item.parentDir}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 「对话」视图空态的通用 AI 首页（07-13-code-home-polish R3）：复用工作台
 * 外壳与 intro 样式骨架，但不出现任何 Code 专属内容（项目名/开发卡）。
 * 8 张通用快捷卡走既有 onSelectSuggestion 通道填充 composer 并聚焦。
 */
function ConversationHomeWorkbench({
  onSelectSuggestion
}: {
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  return (
    <div
      className="ds-code-home-workbench ds-no-drag mx-auto flex w-full min-w-0 items-center justify-center px-3 py-6 sm:px-5 sm:py-8"
      data-testid="conversation-home"
    >
      <div className="ds-chat-content-max-width flex w-full min-w-0 flex-col items-center">
        <BrandHero compact />

        <div className="ds-code-home-intro">
          <p className="ds-code-home-intro-kicker">{t('conversationHomeKicker')}</p>
          <h1 className="ds-code-home-intro-title">{t('conversationHomeTitle')}</h1>
          <p className="ds-code-home-intro-sub">{t('conversationHomeSub')}</p>
        </div>

        <div className="ds-code-home-deck w-full min-w-0">
          <ConversationStarterDeck onSelect={(prompt) => onSelectSuggestion?.(prompt)} />
        </div>

        <div className="ds-code-home-usage w-full min-w-0">
          <InitialSessionUsageHeatmap embedded />
        </div>
      </div>
    </div>
  )
}

export function MessageTimelineEmptyHero({
  route,
  ready,
  runtimeError,
  activeClawChannel,
  codeHome = false,
  conversationHome = false,
  workspaceRoot = '',
  recentWorkspaceRoots = [],
  onPickWorkspace,
  onSelectWorkspaceRoot,
  onRetry,
  onOpenSettings,
  onSelectSuggestion
}: {
  route: 'chat' | 'claw'
  ready: boolean
  runtimeError?: string | null
  activeClawChannel: ClawImChannelV1 | null
  /**
   * 宿主是否是 Code 首页（Workbench 的 chat 场景，store route === 'chat'
   * 且非对话视图）。write/sdd 助手面板复用本组件时为 false——它们的就绪
   * 空态保持原独立热力图形态，不渲染开发者启动工作台。
   */
  codeHome?: boolean
  /**
   * 宿主是否是「对话」视图空态（Workbench 本地 conversationView 经 prop
   * 下传，与 codeHome 在装配层互斥）。true 时渲染通用 AI 首页，不出现
   * 任何 Code 专属内容（07-13-code-home-polish R3）。
   */
  conversationHome?: boolean
  /** 当前工作目录绝对路径（工作台引导行项目名 / 未打开项目判定用）。 */
  workspaceRoot?: string
  /** 最近项目候选（chat-store codeWorkspaceRoots，未打开项目空态展示用）。 */
  recentWorkspaceRoots?: readonly string[]
  onPickWorkspace: () => void
  /** 点击最近项目直接切换（chat-store selectWorkspaceRoot）。 */
  onSelectWorkspaceRoot?: (root: string) => void
  onRetry: () => void
  onOpenSettings: () => void
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  if (!ready) {
    return <RuntimeWakeHero runtimeError={runtimeError} onRetry={onRetry} onOpenSettings={onOpenSettings} />
  }

  if (route === 'claw') {
    return (
      <ClawEmptyHero
        channel={activeClawChannel}
        onSelectSuggestion={onSelectSuggestion}
      />
    )
  }

  if (conversationHome) {
    return <ConversationHomeWorkbench onSelectSuggestion={onSelectSuggestion} />
  }

  if (codeHome) {
    // 未打开项目(空串或 default_workspace 兜底路径)时不再伪装「当前项目 /
    // Claude360 Copilot」,改为行动导向的打开项目空态(R2)。
    if (isNoProjectWorkspace(workspaceRoot)) {
      return (
        <NoProjectWelcome
          recentWorkspaceRoots={recentWorkspaceRoots}
          onPickWorkspace={onPickWorkspace}
          onSelectWorkspaceRoot={onSelectWorkspaceRoot}
        />
      )
    }
    return (
      <CodeHomeWorkbench
        workspaceRoot={workspaceRoot}
        onSelectSuggestion={onSelectSuggestion}
      />
    )
  }

  return <InitialSessionUsageHeatmap />
}

export function ThreadForkBanner({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--ds-accent)_16%,transparent)] bg-accent-soft px-4 py-3 text-ds-muted shadow-[0_14px_36px_color-mix(in_srgb,var(--ds-accent)_5%,transparent)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent">
          <GitFork className="h-4 w-4" strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-ds-ink">
            {t('threadForkBannerTitle')}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-ds-muted">
            {parentTitle
              ? t('threadForkBannerSub', { title: parentTitle })
              : t('threadForkBannerSubUnknown')}
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * Bar shown where the composer normally sits when viewing a subagent's own
 * (`relation: 'side'`) session. The subagent runs autonomously, so there is no
 * input box — only a way back to the parent conversation that delegated it.
 * These threads are hidden from the sidebar, so this is the route home.
 */
export function SubagentReturnBar({
  parentTitle,
  onBack
}: {
  parentTitle: string
  onBack: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      onClick={onBack}
      className="group ds-chat-content-max-width flex w-full items-center gap-3 rounded-[16px] border border-[color-mix(in_srgb,var(--ds-accent)_16%,transparent)] bg-accent-soft px-4 py-3 text-left text-ds-muted shadow-[0_14px_36px_color-mix(in_srgb,var(--ds-accent)_5%,transparent)] transition hover:bg-[color-mix(in_srgb,var(--ds-accent)_14%,transparent)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent">
        <Bot className="h-4 w-4" strokeWidth={1.85} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ds-ink">
          {t('subagentSessionBannerTitle')}
        </span>
        <span className="mt-1 block truncate text-[12.5px] leading-5 text-ds-muted">
          {parentTitle
            ? t('subagentSessionBannerSub', { title: parentTitle })
            : t('subagentSessionBannerSubUnknown')}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent-soft px-2.5 py-1.5 text-[12px] font-semibold text-accent transition group-hover:bg-[color-mix(in_srgb,var(--ds-accent)_15%,transparent)]">
        <CornerUpLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {t('subagentSessionBannerBack')}
      </span>
    </button>
  )
}

export function ThreadForkPoint({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3 py-1 text-[12px] font-medium text-ds-faint">
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
      <span
        className="inline-flex max-w-[min(100%,420px)] items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--ds-accent)_16%,transparent)] bg-ds-card px-3 py-1.5 text-accent shadow-sm"
        title={parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
      >
        <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">
          {parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
        </span>
      </span>
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
    </div>
  )
}
