import {
  BookOpen,
  CalendarCheck,
  Languages,
  Lightbulb,
  ListChecks,
  Mail,
  ScrollText,
  Wand2
} from 'lucide-react'
import type { StarterCard } from './code-starter-deck'

/**
 * 「对话」通用 AI 首页快捷任务卡合同（07-13-code-home-polish design §4.2，
 * 供测试锁定）。
 *
 * 与 Code 版同构：固定 8 张卡，每张三件套 i18n 键
 * `conversationStarterXxxTitle/Sub/Prompt`（en/zh 双写）；Prompt 为多行
 * 续填模板，点击后整体填充 composer 并聚焦。tone 沿用 Code 版三色
 * soft 映射（CODE_STARTER_TONE_CLASS），按 accent/success/skill 循环。
 */
export const CONVERSATION_STARTER_CARDS: readonly StarterCard[] = [
  {
    id: 'summarize',
    icon: ScrollText,
    tone: 'accent',
    titleKey: 'conversationStarterSummarizeTitle',
    subKey: 'conversationStarterSummarizeSub',
    promptKey: 'conversationStarterSummarizePrompt'
  },
  {
    id: 'polish',
    icon: Wand2,
    tone: 'success',
    titleKey: 'conversationStarterPolishTitle',
    subKey: 'conversationStarterPolishSub',
    promptKey: 'conversationStarterPolishPrompt'
  },
  {
    id: 'translate',
    icon: Languages,
    tone: 'skill',
    titleKey: 'conversationStarterTranslateTitle',
    subKey: 'conversationStarterTranslateSub',
    promptKey: 'conversationStarterTranslatePrompt'
  },
  {
    id: 'brainstorm',
    icon: Lightbulb,
    tone: 'accent',
    titleKey: 'conversationStarterBrainstormTitle',
    subKey: 'conversationStarterBrainstormSub',
    promptKey: 'conversationStarterBrainstormPrompt'
  },
  {
    id: 'plan',
    icon: CalendarCheck,
    tone: 'success',
    titleKey: 'conversationStarterPlanTitle',
    subKey: 'conversationStarterPlanSub',
    promptKey: 'conversationStarterPlanPrompt'
  },
  {
    id: 'explainConcept',
    icon: BookOpen,
    tone: 'skill',
    titleKey: 'conversationStarterExplainConceptTitle',
    subKey: 'conversationStarterExplainConceptSub',
    promptKey: 'conversationStarterExplainConceptPrompt'
  },
  {
    id: 'email',
    icon: Mail,
    tone: 'accent',
    titleKey: 'conversationStarterEmailTitle',
    subKey: 'conversationStarterEmailSub',
    promptKey: 'conversationStarterEmailPrompt'
  },
  {
    id: 'keyPoints',
    icon: ListChecks,
    tone: 'success',
    titleKey: 'conversationStarterKeyPointsTitle',
    subKey: 'conversationStarterKeyPointsSub',
    promptKey: 'conversationStarterKeyPointsPrompt'
  }
]
