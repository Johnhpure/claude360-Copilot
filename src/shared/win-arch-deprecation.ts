// Windows ia32 软废弃（07-14-win-ia32-assessment，方案 B）。
// 评估结论：ia32 包核心能力已名存实亡——Agent SDK 上游无 win32-ia32 二进制
// （npm 404 实测）、nut-js libnut 仅 x86-64、whisper 无 ia32 基线；全历史
// ia32 exe 下载量 = 1（x64 = 20）。本批次只做「标注弃用」，不停发：
// 判定函数供 main 启动告警与 renderer 设置页横幅共用；停发/移除按
// .trellis/spec/claude360-copilot/backend/gui-updater.md 的
// 「ia32 Soft Deprecation & Removal Playbook」执行；gui-updater 的
// arch_mismatch 架构守卫必须永久保留（保护存量 ia32 安装不被误装 x64 包）。

/** 下载页（获取 x64 安装包的入口），与 main gui-updater 的 GITHUB_RELEASES_URL 一致。 */
export const WINDOWS_X64_DOWNLOAD_URL = 'https://github.com/Johnhpure/claude360-Copilot/releases'

/** win32 + ia32 组合已进入弃用流程；其余平台/架构一律 false。 */
export function isDeprecatedWindowsArch(platform: string, arch: string): boolean {
  return platform === 'win32' && arch === 'ia32'
}
