import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Bug,
  FlaskConical,
  FolderTree,
  Gauge,
  Rocket,
  SearchCode,
  Wrench
} from 'lucide-react'

/**
 * Code 首页空态「开发者启动工作台」快捷任务卡合同
 * （07-13-code-home-workbench design §2，供测试锁定）。
 *
 * 固定 8 张卡（PRD R2 上限，无「更多」/分组）；每张卡三件套 i18n 键
 * `starterXxxTitle/Sub/Prompt`（en/zh 双写）。Prompt 是多行指令模板：
 * 点击后整体填充 composer 并聚焦、光标置末尾，引导用户按结构继续补充
 * 目标/文件/报错等信息（R3）。
 */

export type CodeStarterTone = 'accent' | 'success' | 'skill'

/** tone → 图标容器配色（沿用旧 ChatStarterGrid 三色 soft 映射，token 双主题自适应）。 */
export const CODE_STARTER_TONE_CLASS: Record<CodeStarterTone, string> = {
  accent: 'bg-accent-soft text-accent',
  success: 'bg-ds-success-soft text-ds-success',
  skill: 'bg-ds-skill-soft text-ds-skill'
}

export type CodeStarterCard = {
  id: string
  icon: LucideIcon
  tone: CodeStarterTone
  titleKey: string
  subKey: string
  promptKey: string
}

/** 8 张快捷任务卡（顺序即渲染顺序；tone 按 accent/success/skill 循环着色）。 */
export const CODE_STARTER_CARDS: readonly CodeStarterCard[] = [
  {
    id: 'feature',
    icon: Rocket,
    tone: 'accent',
    titleKey: 'starterFeatureTitle',
    subKey: 'starterFeatureSub',
    promptKey: 'starterFeaturePrompt'
  },
  {
    id: 'optimize',
    icon: Gauge,
    tone: 'success',
    titleKey: 'starterOptimizeTitle',
    subKey: 'starterOptimizeSub',
    promptKey: 'starterOptimizePrompt'
  },
  {
    id: 'bugfix',
    icon: Bug,
    tone: 'skill',
    titleKey: 'starterBugfixTitle',
    subKey: 'starterBugfixSub',
    promptKey: 'starterBugfixPrompt'
  },
  {
    id: 'structure',
    icon: FolderTree,
    tone: 'accent',
    titleKey: 'starterStructureTitle',
    subKey: 'starterStructureSub',
    promptKey: 'starterStructurePrompt'
  },
  {
    id: 'explain',
    icon: BookOpen,
    tone: 'success',
    titleKey: 'starterExplainTitle',
    subKey: 'starterExplainSub',
    promptKey: 'starterExplainPrompt'
  },
  {
    id: 'tests',
    icon: FlaskConical,
    tone: 'skill',
    titleKey: 'starterTestsTitle',
    subKey: 'starterTestsSub',
    promptKey: 'starterTestsPrompt'
  },
  {
    id: 'refactor',
    icon: Wrench,
    tone: 'accent',
    titleKey: 'starterRefactorTitle',
    subKey: 'starterRefactorSub',
    promptKey: 'starterRefactorPrompt'
  },
  {
    id: 'debug',
    icon: SearchCode,
    tone: 'success',
    titleKey: 'starterDebugTitle',
    subKey: 'starterDebugSub',
    promptKey: 'starterDebugPrompt'
  }
]
