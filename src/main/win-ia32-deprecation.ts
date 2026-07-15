// 启动期 Windows ia32 弃用告警（07-14-win-ia32-assessment R1）。
// win32+ia32 才发一条 logWarn，文案列明三项能力限制（Claude 订阅/Agent SDK、
// 语音转文字、computer-use）+ 弃用计划 + x64 下载指引；其余平台/架构零输出。
// 挂点约束（startup-sequence.md）：只允许挂在 whenReady 尾部 fire-and-forget 区，
// 禁止插入 createWindow → mark('main:ipc-registered') 的同 tick IPC 注册块。
import { isDeprecatedWindowsArch, WINDOWS_X64_DOWNLOAD_URL } from '../shared/win-arch-deprecation'

export const WIN_IA32_DEPRECATION_LOG_CATEGORY = 'win-ia32-deprecation'

export const WIN_IA32_DEPRECATION_WARNING =
  '32 位（ia32）Windows 版本已进入弃用流程：Claude 订阅（Agent SDK）、语音转文字（本地 Whisper）、' +
  'computer-use 桌面控制在 32 位版本上不可用；后续版本将停止发布 32 位安装包，' +
  `请前往下载页安装 64 位（x64）版本：${WINDOWS_X64_DOWNLOAD_URL}`

/**
 * 满足弃用条件时发一条告警并返回 true；否则不触碰 warn 并返回 false。
 * platform/arch/warn 全部注入，便于单测覆盖矩阵（AC1）。
 */
export function warnWindowsIa32Deprecation(options: {
  platform: string
  arch: string
  warn: (category: string, message: string, detail?: unknown) => void
}): boolean {
  if (!isDeprecatedWindowsArch(options.platform, options.arch)) return false
  options.warn(WIN_IA32_DEPRECATION_LOG_CATEGORY, WIN_IA32_DEPRECATION_WARNING, {
    platform: options.platform,
    arch: options.arch,
    downloadUrl: WINDOWS_X64_DOWNLOAD_URL
  })
  return true
}
