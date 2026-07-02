// Suno 参数构造纯函数（Task 4）。
//
// 迁移自 claude360-music-web/src/lib/suno-params.ts，保持参数输出与源项目一致：
// - 删除独立 API client / token 依赖，只保留纯函数便于 node 单测。
// - 类型改用 Copilot 的 @shared/claude360-music（与 main/preload 共享同一份 payload 类型）。
import type {
  Claude360MusicCreateForm,
  Claude360MusicSubmitPayload,
  Claude360PersonaModel,
  Claude360SunoModel,
  Claude360VocalGender
} from '@shared/claude360-music'

// 模型下拉项（中文标注；API 值在 value）。label 含一句话特点，便于用户按需选择。
// 顺序从新到旧；默认 / 推荐使用最新的 V5.5。
export const MODELS: ReadonlyArray<{ value: Claude360SunoModel; label: string }> = [
  { value: 'V5_5', label: 'V5.5 · 最新推荐 — 定制专属音色，贴合你的独特品味' },
  { value: 'V5', label: 'V5 — 更卓越的音乐表现力，生成速度更快' },
  { value: 'V4_5PLUS', label: 'V4.5+ — 音色更丰富，全新创作方式，最长 8 分钟' },
  { value: 'V4_5ALL', label: 'V4.5 All — 更好的歌曲结构，最长 8 分钟' },
  { value: 'V4_5', label: 'V4.5 — 更智能的提示词，更快的生成速度，最长 8 分钟' },
  { value: 'V4', label: 'V4 — 改进的人声质量，最长 4 分钟' }
]

export function supportsVocalGender(model: Claude360SunoModel): boolean {
  return model !== 'V4' // 仅 V4.5 及以上
}
export function supportsVoicePersona(model: Claude360SunoModel): boolean {
  return model === 'V5' || model === 'V5_5'
}

// 曲风预设（迁移自 music-web StandardMode.tsx STYLE_PRESETS，取值一致）。
// 点击 chip 把该词 toggle 进/出 form.style（逗号分隔串），纯前端，无接口。
export const STYLE_PRESETS: readonly string[] = [
  '合成波',
  '流行',
  '低保真',
  '爵士',
  '节奏布鲁斯',
  '电子',
  '民谣',
  '嘻哈',
  '摇滚',
  '古典',
  '电影感'
]

export function emptyForm(): Claude360MusicCreateForm {
  return {
    mode: 'oneshot',
    description: '',
    customMode: true,
    instrumental: false,
    model: 'V5_5',
    title: '',
    style: '',
    lyrics: '',
    negativeTags: '',
    vocalGender: '' as Claude360VocalGender,
    styleWeight: 0,
    weirdness: 0,
    personaId: '',
    personaModel: '' as Claude360PersonaModel
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const firstLine = (s: string): string => (s.split('\n')[0] || '').trim()

export function buildSubmitPayload(form: Claude360MusicCreateForm): Claude360MusicSubmitPayload {
  const p: Claude360MusicSubmitPayload = { prompt: '', model: form.model }

  if (form.mode === 'oneshot') {
    // 简单模式：只填描述时由模型自动扩写；填歌词时按参考端语义进入自定义模式。
    const description = form.description.trim()
    const lyrics = form.lyrics.trim()
    if (lyrics) {
      p.custom_mode = true
      p.prompt = lyrics
      if (description) {
        p.style = description
        p.title = firstLine(description) || '未命名'
      }
    } else {
      p.custom_mode = false
      p.prompt = description
    }
    if (form.instrumental) p.instrumental = true
    return p
  }

  // 标准模式
  p.custom_mode = form.customMode
  p.prompt = form.lyrics.trim()
  if (form.title.trim()) p.title = form.title.trim()
  if (form.style.trim()) p.style = form.style.trim()
  if (form.instrumental) p.instrumental = true
  if (supportsVocalGender(form.model) && (form.vocalGender === 'm' || form.vocalGender === 'f')) {
    p.vocal_gender = form.vocalGender
  }
  if (form.styleWeight > 0) p.style_weight = round2(form.styleWeight)
  if (form.weirdness > 0) p.weirdness_constraint = round2(form.weirdness)
  if (form.negativeTags.trim()) p.negative_tags = form.negativeTags.trim()
  if (form.personaId.trim()) {
    p.persona_id = form.personaId.trim()
    if (form.personaModel === 'voice_persona' && !supportsVoicePersona(form.model)) {
      p.persona_model = 'style_persona'
    } else if (form.personaModel) {
      p.persona_model = form.personaModel
    }
  }
  return p
}

export function validateForm(form: Claude360MusicCreateForm): string[] {
  const errs: string[] = []
  if (form.mode === 'oneshot') {
    if (!form.description.trim()) errs.push('请填写一句话描述')
    return errs
  }
  if (form.customMode) {
    if (!form.instrumental && !form.lyrics.trim()) errs.push('自定义模式请填写歌词，或开启纯器乐')
    if (!form.style.trim()) errs.push('自定义模式请填写曲风')
  } else {
    if (!form.lyrics.trim()) errs.push('请填写音乐描述')
  }
  return errs
}
