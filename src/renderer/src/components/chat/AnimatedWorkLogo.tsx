import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import kunLogo from '../../../../asset/img/kun_bird.png'
import kunSurfFigure from '../../../../asset/img/kun_surf.png'
import kunGreetFigure from '../../../../asset/img/kun_greet.png'
import kunSleepFigure from '../../../../asset/img/kun_sleep.png'
import kunSitFigure from '../../../../asset/img/kun_sit.png'

export type WorkLogoSwimMode = 'propel' | 'sprint' | 'dive' | 'surf'

export const WORK_LOGO_SWIM_MODES: readonly WorkLogoSwimMode[] = [
  'propel',
  'sprint',
  'dive',
  'surf'
]

export const WORK_LOGO_SWIM_MODE_LABEL_KEYS: Record<WorkLogoSwimMode, string> = {
  propel: 'working',
  sprint: 'workingSprint',
  dive: 'workingDive',
  surf: 'workingSurf'
}

const WORK_LOGO_SWIM_MODE_INTERVAL_MS = 4200

export function useWorkLogoSwimMode(active: boolean): WorkLogoSwimMode {
  // 起点随机,避免每次都从「推进中」开始;之后按顺序轮播
  const [modeIndex, setModeIndex] = useState(() =>
    Math.floor(Math.random() * WORK_LOGO_SWIM_MODES.length)
  )

  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => {
      setModeIndex((current) => (current + 1) % WORK_LOGO_SWIM_MODES.length)
    }, WORK_LOGO_SWIM_MODE_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [active])

  return WORK_LOGO_SWIM_MODES[modeIndex] ?? 'propel'
}

export type KunStateFigureKind = 'greet' | 'sleep' | 'sit'

const KUN_STATE_FIGURES: Record<KunStateFigureKind, string> = {
  greet: kunGreetFigure,
  sleep: kunSleepFigure,
  sit: kunSitFigure
}

/** 静态场景里的形象:打招呼(欢迎)、睡觉(运行时待唤醒)、坐着(空状态) */
export function KunStateFigure({
  kind,
  className = ''
}: {
  kind: KunStateFigureKind
  className?: string
}): ReactElement {
  return (
    <span
      className={['ds-kun-state', `ds-kun-state-${kind}`, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <img
        className="ds-kun-state-figure"
        src={KUN_STATE_FIGURES[kind]}
        alt=""
        draggable={false}
        decoding="async"
      />
    </span>
  )
}

export function AnimatedWorkLogo({
  active = false,
  className = '',
  mode,
  phase = 'lead',
  size = 'sm'
}: {
  active?: boolean
  className?: string
  mode?: WorkLogoSwimMode
  phase?: 'lead' | 'trail'
  size?: 'sm' | 'md'
}): ReactElement {
  const rotatedSwimMode = useWorkLogoSwimMode(active && mode === undefined)
  const swimMode = mode ?? rotatedSwimMode
  const figureSrc = swimMode === 'surf' ? kunSurfFigure : kunLogo

  return (
    <span
      className={[
        'ds-work-logo',
        `ds-work-logo-${size}`,
        `ds-work-logo-phase-${phase}`,
        `ds-work-logo-mode-${swimMode}`,
        active ? 'is-active' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <span className="ds-work-logo-gust" />
      <span className="ds-work-logo-current" />
      <span className="ds-work-logo-swell" />
      <span className="ds-work-logo-wave ds-work-logo-wave-back" />
      <span className="ds-work-logo-ripple" />
      <span className="ds-work-logo-wave ds-work-logo-wave-front" />
      <span className="ds-work-logo-breaker" />
      <span className="ds-work-logo-wake" />
      <span className="ds-work-logo-foam" />
      <span className="ds-work-logo-crest" />
      <span className="ds-work-logo-splash" />
      <span className="ds-work-logo-spray" />
      <span className="ds-work-logo-bubbles" />
      <img className="ds-work-logo-echo" src={figureSrc} alt="" draggable={false} decoding="async" />
      <span className="ds-work-logo-track">
        <span className="ds-work-logo-body">
          <img className="ds-work-logo-image" src={figureSrc} alt="" draggable={false} decoding="async" />
        </span>
      </span>
    </span>
  )
}
