import type { ReactElement } from 'react'
import {
  Headphones,
  Laptop,
  PartyPopper,
  Search,
  Sparkles,
  WandSparkles,
  Wrench,
  type LucideIcon
} from 'lucide-react'

/**
 * Animated Claude360 Copilot agent avatar. Each role id maps to a small
 * branded icon with a per-role CSS animation (float / sway / breathe / bob).
 */

type Anim = 'float' | 'sway' | 'breathe' | 'bob'

const STYLE_ID = 'ds-agent-kun-style'
const STYLE = `
@keyframes dsKunFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes dsKunSway{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@keyframes dsKunBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes dsKunBob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-2.5px) rotate(3deg)}}
.ds-agent-kun{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid var(--ds-border-muted);background:var(--ds-surface);color:var(--ds-accent);box-shadow:var(--c360-shadow-sm)}
.ds-agent-kun svg{width:58%;height:58%;filter:drop-shadow(0 2px 3px var(--ds-border-muted))}
.ds-agent-kun.is-disabled{color:var(--ds-muted);filter:grayscale(1) opacity(.72)}
.ds-agent-kun-float svg{animation:dsKunFloat 2.4s ease-in-out infinite}
.ds-agent-kun-sway svg{animation:dsKunSway 2.1s ease-in-out infinite;transform-origin:50% 90%}
.ds-agent-kun-breathe svg{animation:dsKunBreathe 3s ease-in-out infinite}
.ds-agent-kun-bob svg{animation:dsKunBob 2.7s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.ds-agent-kun svg{animation:none!important}}
`

function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = STYLE
  document.head.appendChild(el)
}

const POSE: Record<string, { Icon: LucideIcon; anim: Anim }> = {
  general: { Icon: Laptop, anim: 'breathe' },
  explore: { Icon: Search, anim: 'float' },
  'design-reviewer': { Icon: Sparkles, anim: 'bob' },
  'over-engineering-reviewer': { Icon: Wrench, anim: 'sway' },
  'code-review': { Icon: Sparkles, anim: 'breathe' },
  compaction: { Icon: WandSparkles, anim: 'sway' },
  title: { Icon: PartyPopper, anim: 'bob' },
  summary: { Icon: Headphones, anim: 'float' }
}

const FALLBACK: { Icon: LucideIcon; anim: Anim } = { Icon: Wrench, anim: 'breathe' }

/**
 * @param id      role id (drives the pose); unknown ids → fallback (custom kun)
 * @param disabled when true, renders resting kun in grayscale with no motion
 * @param className sizing wrapper class (e.g. "h-10 w-10")
 */
export function AgentKun({
  id,
  disabled = false,
  className
}: {
  id: string
  /** Retained for API compatibility with old callers; unused (PNGs are fixed). */
  color?: string
  disabled?: boolean
  className?: string
}): ReactElement {
  ensureStyle()
  if (disabled) {
    return (
      <span className={`ds-agent-kun is-disabled ${className ?? ''}`}>
        <Wrench aria-hidden="true" strokeWidth={1.8} />
      </span>
    )
  }
  const pose = POSE[id] ?? FALLBACK
  const Icon = pose.Icon
  return (
    <span className={`ds-agent-kun ds-agent-kun-${pose.anim} ${className ?? ''}`}>
      <Icon aria-hidden="true" strokeWidth={1.8} />
    </span>
  )
}
