// Suno 参数构造纯函数测试（Task 4）。
// 用例直接迁移自 claude360-music-web/src/lib/suno-params.test.ts，
// 仅把类型来源换成 Copilot 的 @shared/claude360-music，保持行为断言不变。
import { describe, it, expect } from 'vitest'
import {
  MODELS,
  supportsVocalGender,
  supportsVoicePersona,
  buildSubmitPayload,
  validateForm,
  emptyForm
} from './suno-params'
import type { Claude360MusicCreateForm } from '@shared/claude360-music'

const base: Claude360MusicCreateForm = { ...emptyForm() }

describe('模型能力表', () => {
  it('MODELS 首项为最新推荐的 V5_5，且各项含中文特点说明', () => {
    expect(MODELS[0].value).toBe('V5_5')
    const def = MODELS.find((m) => m.value === 'V5_5')
    expect(def?.label).toContain('推荐')
    // 每个模型项都带一句话特点（用破折号分隔），便于用户选择
    expect(MODELS.every((m) => m.label.includes('—'))).toBe(true)
  })
  it('vocal_gender 仅 V4.5 及以上支持', () => {
    expect(supportsVocalGender('V4')).toBe(false)
    expect(supportsVocalGender('V4_5')).toBe(true)
    expect(supportsVocalGender('V5_5')).toBe(true)
  })
  it('voice_persona 仅 V5 / V5.5 支持', () => {
    expect(supportsVoicePersona('V4_5')).toBe(false)
    expect(supportsVoicePersona('V5')).toBe(true)
    expect(supportsVoicePersona('V5_5')).toBe(true)
  })
})

describe('buildSubmitPayload · 一句话模式', () => {
  it('只填描述 → custom_mode=false, prompt=描述', () => {
    const f = { ...base, mode: 'oneshot', description: '轻快的城市夜晚电子乐' } as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect(p.custom_mode).toBe(false)
    expect(p.prompt).toBe('轻快的城市夜晚电子乐')
    expect(p.style).toBeUndefined()
  })
  it('填了歌词 → custom_mode=true, prompt=歌词, style=描述, title 自动', () => {
    const f = {
      ...base,
      mode: 'oneshot',
      description: '城市夜晚',
      lyrics: '[Verse]\n霓虹河流'
    } as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect(p.custom_mode).toBe(true)
    expect(p.prompt).toBe('[Verse]\n霓虹河流')
    expect(p.style).toBe('城市夜晚')
    expect(p.title).toBe('城市夜晚')
  })
  it('纯器乐 → instrumental=true', () => {
    const f = { ...base, mode: 'oneshot', description: '城市夜晚', instrumental: true } as Claude360MusicCreateForm
    expect(buildSubmitPayload(f).instrumental).toBe(true)
  })
})

describe('buildSubmitPayload · 标准模式', () => {
  it('自定义模式：prompt=歌词，含 style/title', () => {
    const f = {
      ...base,
      mode: 'standard',
      customMode: true,
      model: 'V5_5',
      lyrics: '[Verse] Neon',
      style: 'synthwave',
      title: 'Electric'
    } as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect(p.custom_mode).toBe(true)
    expect(p.prompt).toBe('[Verse] Neon')
    expect(p.style).toBe('synthwave')
    expect(p.title).toBe('Electric')
  })
  it('低版本模型丢弃 vocal_gender', () => {
    const f = {
      ...base, mode: 'standard', customMode: true, model: 'V4', lyrics: 'x', style: 'pop', vocalGender: 'f'
    } as Claude360MusicCreateForm
    expect(buildSubmitPayload(f).vocal_gender).toBeUndefined()
  })
  it('V4.5+ 保留 vocal_gender', () => {
    const f = {
      ...base, mode: 'standard', customMode: true, model: 'V4_5', lyrics: 'x', style: 'pop', vocalGender: 'f'
    } as Claude360MusicCreateForm
    expect(buildSubmitPayload(f).vocal_gender).toBe('f')
  })
  it('滑块为 0 时省略，>0 时保留并保留两位小数', () => {
    const f = {
      ...base, mode: 'standard', customMode: true, model: 'V5', lyrics: 'x', style: 'pop', styleWeight: 0, weirdness: 0.7
    } as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect(p.style_weight).toBeUndefined()
    expect(p.weirdness_constraint).toBe(0.7)
  })
  it('不透传旧版 audioWeight/audio_weight 字段', () => {
    const f = {
      ...base,
      mode: 'standard',
      customMode: true,
      model: 'V5',
      lyrics: 'x',
      style: 'pop',
      audioWeight: 0.7
    } as unknown as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect('audio_weight' in p).toBe(false)
  })
  it('voice_persona 在不支持的模型上降级为 style_persona', () => {
    const f = {
      ...base,
      mode: 'standard',
      customMode: true,
      model: 'V4_5',
      lyrics: 'x',
      style: 'pop',
      personaId: 'p1',
      personaModel: 'voice_persona'
    } as Claude360MusicCreateForm
    const p = buildSubmitPayload(f)
    expect(p.persona_id).toBe('p1')
    expect(p.persona_model).toBe('style_persona')
  })
})

describe('validateForm', () => {
  it('一句话模式缺描述 → 报错', () => {
    expect(validateForm({ ...base, mode: 'oneshot', description: '' } as Claude360MusicCreateForm)).toContain('请填写一句话描述')
  })
  it('自定义模式缺曲风 → 报错', () => {
    const errs = validateForm({ ...base, mode: 'standard', customMode: true, lyrics: 'x', style: '' } as Claude360MusicCreateForm)
    expect(errs.some((e) => e.includes('曲风'))).toBe(true)
  })
  it('合法的一句话描述 → 无错误', () => {
    expect(validateForm({ ...base, mode: 'oneshot', description: '一首钢琴曲' } as Claude360MusicCreateForm)).toEqual([])
  })
})
