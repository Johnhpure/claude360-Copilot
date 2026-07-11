import type { ReactElement } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  FileQuestion,
  ImagePlus,
  LayoutGrid,
  ListMusic,
  MessageCirclePlus,
  Plus,
  Workflow
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { isPrimaryRouteVisible } from '../../lib/feature-visibility'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import type {
  ClawImChannelV1,
} from '@shared/app-settings'
import {
  ClawSidebarContent
} from './SidebarClaw'
import type { ClawImDialogMode } from './SidebarClawDialogHelpers'
import { ClawAddImDialog } from './SidebarClawDialog'
import { ConnectPhoneSidebarPanel } from './ConnectPhoneView'
import { SidebarProjectsSection } from './SidebarProjectsSection'
import { SidebarConversationsSection } from './SidebarConversationsSection'
import { FeatureSwitcher, type Feature } from '../shell/FeatureSwitcher'
import {
  SidebarCommandRow,
  SidebarDivider,
  SidebarFrame
} from '../sidebar/SidebarPrimitives'
import {
  SidebarContextActions,
  type SidebarContextAction
} from '../sidebar/SidebarContextActions'
import { SidebarThemeToggle } from '../sidebar/SidebarThemeToggle'
import { SidebarFooterNav } from '../sidebar/SidebarFooterNav'

type Props = {
  threads: NormalizedThread[]
  activeThreadId: string | null
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow' | 'subagents'
  connectPhoneSidebarOpen: boolean
  pluginsActive: boolean
  runtimeReady: boolean
  threadSearch: string
  showArchivedThreads: boolean
  onThreadSearchChange: (query: string) => void
  onSelectThread: (id: string) => void
  onRenameThread: (id: string, title: string) => Promise<void>
  onPinThread: (id: string, pinned: boolean) => Promise<void>
  onArchiveThread: (id: string) => Promise<void>
  onDeleteThread: (id: string) => Promise<void>
  onRestoreThread: (id: string) => Promise<void>
  onNewChat: () => void
  onNewChatInWorkspace: (workspaceRoot: string) => void
  onNewRequirement: () => void
  onOpenRequirementDraft: (draft: SddDraft) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onOpenPlugins: () => void
  onOpenMy: () => void
  myActive: boolean
  onOpenCanvas: () => void
  onOpenMusic: () => void
  canvasActive: boolean
  musicActive: boolean
  /** 「对话」一级视图激活态（route==='chat' 且 Workbench 本地 conversationView）。 */
  conversationActive: boolean
  /** 打开「对话」一级视图（回 chat route + 置 conversationView）。 */
  onOpenConversation: () => void
  onToggleTheme: () => void
  onToggleConnectPhone: () => void
  onCodeOpen: () => void
  onWriteOpen: () => void
  onScheduleOpen: () => void
  onWorkflowOpen: () => void
  onNewConversation: () => void
}

export function Sidebar({
  threads,
  activeThreadId,
  activeView,
  connectPhoneSidebarOpen,
  pluginsActive,
  runtimeReady,
  threadSearch,
  showArchivedThreads,
  onThreadSearchChange,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onNewChat,
  onNewChatInWorkspace,
  onNewRequirement,
  onOpenRequirementDraft,
  onOpenSettings,
  onOpenPlugins,
  onOpenMy,
  myActive,
  onOpenCanvas,
  onOpenMusic,
  canvasActive,
  musicActive,
  conversationActive,
  onOpenConversation,
  onToggleTheme,
  onToggleConnectPhone,
  onCodeOpen,
  onWriteOpen,
  onScheduleOpen,
  onWorkflowOpen,
  onNewConversation
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')

  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const conversationWorkspaceRoot = useChatStore((s) => s.conversationWorkspaceRoot)
  const codeWorkspaceRoots = useChatStore((s) => s.codeWorkspaceRoots)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const deleteWorkspace = useChatStore((s) => s.deleteWorkspace)
  const busy = useChatStore((s) => s.busy)
  const watchTurnCompletion = useChatStore((s) => s.watchTurnCompletion)
  const unreadThreadIds = useChatStore((s) => s.unreadThreadIds)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const selectClawChannel = useChatStore((s) => s.selectClawChannel)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const resetClawChannelSession = useChatStore((s) => s.resetClawChannelSession)
  const [imDialogMode, setImDialogMode] = useState<ClawImDialogMode | null>(null)

  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? clawChannels[0] ?? null,
    [clawChannels, activeClawChannelId]
  )

  /* 当前激活的一级功能（07-11 信息架构重构 design D1/D3）。
     单值互斥优先级：canvas → music → conversation → chat/write → null；
     canvas/music/conversation 均寄生在派生 sidebarView='chat' 之上，必须先判。
     claw/schedule/workflow 等辅助路由落 null（一级入口不高亮）。 */
  const activeFeature: Feature | null = canvasActive
    ? 'canvas'
    : musicActive
      ? 'music'
      : conversationActive
        ? 'conversation'
        : activeView === 'chat' || activeView === 'write'
          ? activeView
          : null

  /* 区3「当前操作」显示矩阵（design §2）：按激活功能给出二级操作。
     - Code：新建会话(accent) + 新建需求（运行时未连接时禁用）
     - 对话：新建对话(accent)（复用 onNewConversation 既有链路）
     - 生图/音乐：新建任务(accent)——工作台无现成「新建任务」store action
       （music 表单是组件本地 state），按 design D4 兜底为进入工作台初始新建态。
     - claw/schedule/workflow：无区3（现状保持）。 */
  const contextActions: SidebarContextAction[] =
    activeFeature === 'chat'
      ? [
          {
            icon: <Plus className="h-4 w-4" strokeWidth={2} />,
            label: t('newAgent'),
            onClick: runtimeReady ? onNewChat : undefined,
            disabled: !runtimeReady,
            disabledHint: t('runtimeActionNeedsConnection'),
            accent: true
          },
          {
            icon: <FileQuestion className="h-4 w-4" strokeWidth={1.9} />,
            label: t('sddNewRequirement'),
            onClick: runtimeReady ? onNewRequirement : undefined,
            disabled: !runtimeReady,
            disabledHint: t('runtimeActionNeedsConnection')
          }
        ]
      : activeFeature === 'conversation'
        ? [
            {
              icon: <MessageCirclePlus className="h-4 w-4" strokeWidth={1.9} />,
              label: t('newConversation'),
              onClick: runtimeReady ? onNewConversation : undefined,
              disabled: !runtimeReady,
              disabledHint: t('runtimeActionNeedsConnection'),
              accent: true
            }
          ]
        : activeFeature === 'canvas'
          ? [
              {
                icon: <ImagePlus className="h-4 w-4" strokeWidth={1.9} />,
                label: t('newCanvasTask'),
                onClick: onOpenCanvas,
                accent: true
              }
            ]
          : activeFeature === 'music'
            ? [
                {
                  icon: <ListMusic className="h-4 w-4" strokeWidth={1.9} />,
                  label: t('newMusicTask'),
                  onClick: onOpenMusic,
                  accent: true
                }
              ]
            : []

  return (
    <>
    <SidebarFrame
      title={t('appName')}
      footer={
        <SidebarFooterNav
          onOpenMy={onOpenMy}
          myActive={myActive}
          onOpenSettings={() => onOpenSettings('general')}
          settingsAccessory={<SidebarThemeToggle onToggleTheme={onToggleTheme} />}
        />
      }
    >
      <div className="ds-no-drag flex flex-col px-1">
        {/* 区2 一级功能入口（Code/写作/生图/音乐/对话，07-11 起五项）。
            active 单值互斥：canvas/music/conversation 激活时 Code 不同时高亮。 */}
        <FeatureSwitcher
          active={activeFeature}
          visible={{
            canvas: isPrimaryRouteVisible('canvas'),
            music: isPrimaryRouteVisible('music')
          }}
          onOpen={(feature) => {
            if (feature === 'chat') onCodeOpen()
            else if (feature === 'write') onWriteOpen()
            else if (feature === 'canvas') onOpenCanvas()
            else if (feature === 'music') onOpenMusic()
            else onOpenConversation()
          }}
        />

        {/* 区3 当前操作：与一级入口分隔隔离，按 activeFeature 显示矩阵渲染
            （claw/schedule/workflow 下矩阵为空，不渲染）。 */}
        <SidebarContextActions actions={contextActions} />

        {/* 隐藏≠删除:第一阶段不暴露插件/定时任务/Workflow 入口,
            但保留 onOpenPlugins/onScheduleOpen/onWorkflowOpen 等 handler 与 props。 */}
        {isPrimaryRouteVisible('plugins') ? (
          <SidebarCommandRow
            icon={<LayoutGrid className="h-4 w-4" strokeWidth={1.75} />}
            label={t('plugins')}
            onClick={onOpenPlugins}
            active={pluginsActive}
          />
        ) : null}
        {isPrimaryRouteVisible('schedule') ? (
          <SidebarCommandRow
            icon={<Clock3 className="h-4 w-4" strokeWidth={1.75} />}
            label={t('schedule')}
            onClick={onScheduleOpen}
            active={activeView === 'schedule'}
          />
        ) : null}
        {isPrimaryRouteVisible('workflow') ? (
          <SidebarCommandRow
            icon={<Workflow className="h-4 w-4" strokeWidth={1.75} />}
            label={t('workflow')}
            onClick={onWorkflowOpen}
            active={activeView === 'workflow'}
          />
        ) : null}
      </div>

      <div className="ds-no-drag mx-1 my-1" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : activeView === 'claw' ? (
        <ClawSidebarContent
          channels={clawChannels}
          activeChannelId={activeClawChannelId}
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          onSelectChannel={(channelId) => void selectClawChannel(channelId)}
          onAddChannel={() => setImDialogMode('add')}
          onResetChannel={(channelId) => void resetClawChannelSession(channelId)}
          onOpenSettings={() => setImDialogMode('edit')}
          t={t}
        />
      ) : activeView === 'workflow' ? (
        <div className="ds-no-drag flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Workflow className="h-7 w-7 text-ds-faint" strokeWidth={1.5} />
          <p className="text-[12.5px] leading-5 text-ds-faint">{t('workflowSidebarHint')}</p>
        </div>
      ) : activeView === 'schedule' ? (
        <SidebarProjectsSection
          threads={threads}
          activeView="chat"
          activeThreadId={activeThreadId}
          runtimeReady={runtimeReady}
          searchQuery={threadSearch}
          showArchived={showArchivedThreads}
          workspaceRoot={workspaceRoot}
          workspaceRoots={codeWorkspaceRoots}
          conversationRoot={conversationWorkspaceRoot}
          busy={busy}
          watchTurnCompletion={watchTurnCompletion}
          unreadThreadIds={unreadThreadIds}
          locale={i18n.language}
          onPickWorkspace={() => void chooseWorkspace()}
          onRemoveWorkspace={deleteWorkspace}
          onCreateThreadInWorkspace={onNewChatInWorkspace}
          onOpenRequirementDraft={onOpenRequirementDraft}
          onSelectThread={onSelectThread}
          onRenameThread={onRenameThread}
          onPinThread={onPinThread}
          onArchiveThread={onArchiveThread}
          onDeleteThread={onDeleteThread}
          onRestoreThread={onRestoreThread}
          onSearchQueryChange={onThreadSearchChange}
          t={t}
        />
      ) : canvasActive || musicActive ? null : conversationActive ? (
        <>
          {/* 区4·对话视图：仅对话线程列表（fill 占满剩余高度），项目区块不渲染。
              区块 header 原有搜索/+ 按钮保留（design D5）。 */}
          <SidebarDivider className="mb-1" />
          <SidebarConversationsSection
            threads={threads}
            activeThreadId={activeThreadId}
            runtimeReady={runtimeReady}
            conversationRoot={conversationWorkspaceRoot}
            fill
            onNewConversation={onNewConversation}
            onSelectThread={onSelectThread}
            onRenameThread={onRenameThread}
            onPinThread={onPinThread}
            onArchiveThread={onArchiveThread}
            onDeleteThread={onDeleteThread}
            onRestoreThread={onRestoreThread}
            t={t}
          />
        </>
      ) : (
        <>
          {/* 区4·Code 视图：仅项目区块——左下角对话区块已上移为一级「对话」视图
              （07-11 信息架构重构，R4/R5：Code 页不再渲染 SidebarConversationsSection）。 */}
          <SidebarDivider className="mb-1" />
          <SidebarProjectsSection
            threads={threads}
            activeView={activeView === 'write' ? 'write' : 'chat'}
            activeThreadId={activeThreadId}
            runtimeReady={runtimeReady}
            searchQuery={threadSearch}
            showArchived={showArchivedThreads}
            workspaceRoot={workspaceRoot}
            workspaceRoots={codeWorkspaceRoots}
            conversationRoot={conversationWorkspaceRoot}
            busy={busy}
            watchTurnCompletion={watchTurnCompletion}
            unreadThreadIds={unreadThreadIds}
            locale={i18n.language}
            onPickWorkspace={() => void chooseWorkspace()}
            onRemoveWorkspace={deleteWorkspace}
            onCreateThreadInWorkspace={onNewChatInWorkspace}
            onOpenRequirementDraft={onOpenRequirementDraft}
            onSelectThread={onSelectThread}
            onRenameThread={onRenameThread}
            onPinThread={onPinThread}
            onArchiveThread={onArchiveThread}
            onDeleteThread={onDeleteThread}
            onRestoreThread={onRestoreThread}
            onSearchQueryChange={onThreadSearchChange}
            t={t}
          />
        </>
      )}

    </SidebarFrame>

    {imDialogMode ? (
      <ClawAddImDialog
        mode={imDialogMode}
        initialProvider={activeClawChannel?.provider}
        initialChannelId={imDialogMode === 'edit' ? activeClawChannel?.id : undefined}
        channels={clawChannels}
        onClose={() => setImDialogMode(null)}
        onAddProvider={(provider, agentProfile, platformCredential, options) =>
          addClawChannel(provider, agentProfile, platformCredential, options)
        }
        onDeleteChannel={(channelId) => deleteClawChannel(channelId)}
        t={t}
      />
    ) : null}
    </>
  )
}
