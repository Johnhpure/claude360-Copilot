/**
 * 懒加载模块工具（07-14-startup-optimization R1）。
 *
 * 统一「模块级 cached promise + getter」的动态 import 模式（先例：index.ts 的
 * loadGuiUpdaterModule）：首次调用才真正加载，把重依赖的加载成本从主进程
 * 模块求值期挪到首次使用；并发调用共享同一个 in-flight promise（去重）；
 * 加载失败时重置缓存允许下次重试（避免一次瞬时失败永久卡死），错误原样
 * 透传给调用方。
 */
export function createLazyModule<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null
  return () => {
    if (!cached) {
      const pending = load().catch((error: unknown) => {
        if (cached === pending) cached = null
        throw error
      })
      cached = pending
    }
    return cached
  }
}
