// Claude360 原生音乐工作台共享类型（plan-05 Task 1）。
//
// 迁移自 claude360-music-web 的最小类型集（create mode / form / submit / fetch /
// task status / song）。命名与源项目保持一致，避免主/渲染两侧再加转换层。
//
// Risk Notes 约束：
// - 不迁移 music-web 的独立 auth / token 类型；shared 类型里**绝不**出现 API Key。
// - API Key 只在 main 进程读取使用，renderer 只拿到展示态结果。

// —— Suno 模型（迁移自 music-web types.ts，取值与上游一致）——
export type Claude360SunoModel = 'V4' | 'V4_5' | 'V4_5PLUS' | 'V4_5ALL' | 'V5' | 'V5_5'
export type Claude360VocalGender = '' | 'm' | 'f'
export type Claude360PersonaModel = '' | 'style_persona' | 'voice_persona'

// —— 创作模式（一句话 / 标准共享底层字段）——
export type Claude360MusicCreateMode = 'oneshot' | 'standard'

// —— 创作面板统一表单模型（迁移自 music-web CreateForm）——
export interface Claude360MusicCreateForm {
  mode: Claude360MusicCreateMode
  description: string // 一句话模式：歌曲描述
  customMode: boolean // 标准模式：自定义模式开关
  instrumental: boolean
  model: Claude360SunoModel
  title: string
  style: string // 曲风
  lyrics: string // 标准模式歌词(=prompt)
  negativeTags: string
  vocalGender: Claude360VocalGender
  styleWeight: number // 0–1
  weirdness: number // 0–1
  personaId: string
  personaModel: Claude360PersonaModel
}

// —— 提交给 /suno/submit/music 的请求体（迁移自 music-web SunoSubmitPayload）——
// 可选字段仅在有有效值时发送；custom_mode 例外，按模式显式传 true/false。
export interface Claude360MusicSubmitPayload {
  prompt: string
  model: string
  custom_mode?: boolean
  instrumental?: boolean
  title?: string
  style?: string
  vocal_gender?: 'm' | 'f'
  style_weight?: number
  weirdness_constraint?: number
  negative_tags?: string
  persona_id?: string
  persona_model?: string
}

// —— 歌曲项（迁移自 music-web Song，字段名保持一致）——
export interface Claude360Song {
  id: string
  audioUrl: string
  imageUrl?: string
  title: string
  text?: string
  duration?: number
  tags?: string
  modelName?: string
}

// —— 任务状态（迁移自 music-web TaskStatus，命名严格一致，不发明新状态）——
// submitting：提交网络请求中（无 taskId）
// queued：上游排队（NOT_START/SUBMITTED/QUEUED）
// in_progress：生成中
// success：成功
// failure：失败
export type Claude360MusicTaskStatus =
  | 'submitting'
  | 'queued'
  | 'in_progress'
  | 'success'
  | 'failure'

/** 运行期状态枚举清单（供类型完整性测试与 renderer 复用；顺序与语义同 music-web）。 */
export const CLAUDE360_MUSIC_TASK_STATUSES: readonly Claude360MusicTaskStatus[] = [
  'submitting',
  'queued',
  'in_progress',
  'success',
  'failure'
]

// —— 归一化后的单个任务结果（迁移自 music-web api/suno.ts FetchedTask）——
// unresolved：上游状态不在已知集合内（如 UNKNOWN），交由 renderer 轮询兜底，
// 避免未知终态被当作 in_progress 永久轮询。
export interface Claude360MusicFetchedTask {
  taskId: string
  status: Claude360MusicTaskStatus
  failReason?: string
  songs: Claude360Song[]
  unresolved?: boolean
}

// —— main → renderer 的提交结果（不含 API Key）——
export type Claude360MusicSubmitResult =
  | { ok: true; taskId: string }
  | { ok: false; message: string; retryable?: boolean }

// —— main → renderer 的查询结果（不含 API Key）——
export type Claude360MusicFetchResult =
  | { ok: true; task: Claude360MusicFetchedTask }
  | { ok: false; message: string; retryable?: boolean }

// —— main → renderer 的音乐媒体代理结果（不含 API Key）——
// 用于 HTMLAudioElement 无法携带鉴权 header 播放时，由 main 进程代取音频 blob。
export type Claude360MusicMediaBlobResult =
  | { ok: true; url: string; mimeType: string; base64: string }
  | { ok: false; message: string; retryable?: boolean }
