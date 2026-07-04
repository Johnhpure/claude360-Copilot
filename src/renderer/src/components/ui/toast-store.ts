import { create } from 'zustand'

/**
 * 全局 Toast 队列（阶段2 新建，父任务 design §4.8 Toast 行）。
 *
 * 使用：`import { toast } from '../ui'` 后 `toast.success('已保存')`。
 * 出口 `<Toaster />` 由 AppShell 挂载一次；最多同屏 5 条，超出丢弃最旧。
 */
export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export type ToastItem = {
  id: number
  kind: ToastKind
  message: string
  description?: string
  /** 自动关闭毫秒数；0 表示常驻（需手动关） */
  duration: number
}

type ToastState = {
  items: ToastItem[]
  push: (item: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

const MAX_VISIBLE = 5
let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (item) =>
    set((s) => ({
      items: [...s.items, { ...item, id: nextId++ }].slice(-MAX_VISIBLE)
    })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}))

type ToastOptions = {
  description?: string
  /** 默认 3500ms（§4.8）；0 = 常驻 */
  duration?: number
}

function emit(kind: ToastKind, message: string, options?: ToastOptions): void {
  useToastStore.getState().push({
    kind,
    message,
    description: options?.description,
    duration: options?.duration ?? 3500
  })
}

export const toast = {
  success: (message: string, options?: ToastOptions): void => emit('success', message, options),
  error: (message: string, options?: ToastOptions): void => emit('error', message, options),
  info: (message: string, options?: ToastOptions): void => emit('info', message, options),
  warning: (message: string, options?: ToastOptions): void => emit('warning', message, options)
}
