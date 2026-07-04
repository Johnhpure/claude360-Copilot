/**
 * 浮层 blur 偏好（阶段2 blur 降级开关，AC2/AC8）。
 *
 * 'on'（默认）：Modal 遮罩 / Popover / Toast 使用 backdrop-filter
 *   blur(var(--blur-overlay|--blur-toast))；
 * 'off'：html[data-blur='off'] 生效，两 token 归零（见 ui-primitives.css），
 *   供低端 GPU 或掉帧场景降级。
 *
 * 设置页 UI 入口在阶段5 接入；当前可经 DevTools 验证：
 *   localStorage.setItem('kun.blur', 'off'); location.reload()
 */
const STORAGE_KEY = 'kun.blur'

export type BlurPreference = 'on' | 'off'

export function readBlurPreference(): BlurPreference {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

export function applyBlurPreference(value: BlurPreference): void {
  const root = document.documentElement
  if (value === 'off') {
    root.setAttribute('data-blur', 'off')
  } else {
    root.removeAttribute('data-blur')
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* localStorage 不可用时静默降级为会话级设置 */
  }
}
