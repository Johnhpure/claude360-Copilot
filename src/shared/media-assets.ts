// 生图 / 音乐资产本地持久化共享类型（07-05 media-assets-persistence）。
//
// 跨 main/preload/renderer 复用：资产记录（metadata JSON 条目）、保存/列出/读取/
// 删除的 IPC 负载与结果。
//
// Risk Notes 约束：
// - 记录里只有展示态字段与工作空间内相对路径，**绝不**出现 API Key。
// - localPath 一律是相对 workspace 的 posix 风格路径（assets/...），由 main 侧
//   生成并校验，renderer 不得拼接绝对路径。

// —— 资产状态机：生成中 pending → completed / failed ——
export type MediaAssetStatus = 'pending' | 'completed' | 'failed'

// —— 图片资产记录（assets/metadata/images.json 条目）——
export interface ImageAssetRecord {
  id: string
  status: MediaAssetStatus
  prompt: string
  model: string
  group?: string
  size?: string
  quality?: string
  format?: string
  createdAt: string
  /** 相对 workspace 的图片文件路径（assets/images/...）；下载失败时缺省。 */
  localPath?: string
  mimeType?: string
  /** 远程原始 URL（本地文件丢失时的回退展示途径）。 */
  remoteUrl?: string
}

// —— 音乐资产记录（assets/metadata/music.json 条目，一条 = 一首歌）——
export interface MusicAssetRecord {
  id: string
  taskId?: string
  status: MediaAssetStatus
  title: string
  lyrics?: string
  prompt?: string
  model?: string
  duration?: number
  tags?: string
  createdAt: string
  /** 相对 workspace 的音频文件路径（assets/music/...）；下载失败时缺省。 */
  localAudioPath?: string
  /** 相对 workspace 的封面文件路径（assets/covers/...）。 */
  localCoverPath?: string
  remoteAudioUrl?: string
  remoteCoverUrl?: string
}

// —— 保存请求（renderer → main）——
export interface MediaAssetsSaveImagePayload {
  workspaceRoot: string
  record: Omit<ImageAssetRecord, 'localPath' | 'status'>
  /** 图片来源二选一：远程 URL（main 代下载）或 base64（不含 data: 前缀）。 */
  source: { url: string } | { b64: string; mimeType: string }
}

export interface MediaAssetsSaveMusicPayload {
  workspaceRoot: string
  record: Omit<MusicAssetRecord, 'localAudioPath' | 'localCoverPath' | 'status'>
  audioUrl: string
  coverUrl?: string
}

// —— 保存结果：ok=true 时返回落盘后的完整记录（含 localPath / status）——
export type MediaAssetsSaveImageResult =
  | { ok: true; record: ImageAssetRecord }
  | { ok: false; message: string }

export type MediaAssetsSaveMusicResult =
  | { ok: true; record: MusicAssetRecord }
  | { ok: false; message: string }

// —— 列出（启动 / 切换工作空间时恢复）——
export interface MediaAssetsListPayload {
  workspaceRoot: string
}

/** 列出时逐条标注本地文件是否缺失（缺失记录保留，UI 显示缺失态）。 */
export type MediaAssetsListResult = {
  ok: true
  images: (ImageAssetRecord & { fileMissing?: boolean })[]
  music: (MusicAssetRecord & { audioMissing?: boolean; coverMissing?: boolean })[]
} | { ok: false; message: string }

// —— 读取本地资产内容（img src / audio 播放用；main 校验路径边界）——
export interface MediaAssetsReadBlobPayload {
  workspaceRoot: string
  /** 必须以 assets/ 开头的相对路径。 */
  relativePath: string
}

export type MediaAssetsReadBlobResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; message: string }

// —— 删除（metadata 必删；deleteFiles=true 时同时删本地文件）——
export interface MediaAssetsDeletePayload {
  workspaceRoot: string
  kind: 'image' | 'music'
  ids: string[]
  deleteFiles?: boolean
}

export type MediaAssetsDeleteResult =
  | { ok: true; removed: number }
  | { ok: false; message: string }
