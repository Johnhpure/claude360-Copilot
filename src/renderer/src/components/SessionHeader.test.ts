import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupI18nTestEnglish } from '../test-support/i18n-en'
import i18n from '../i18n'
import { useChatStore } from '../store/chat-store'
import { SessionHeader } from './SessionHeader'

const initialChatState = useChatStore.getState()

// R1（07-14-renderer-lazy-loading）：本文件以英文文案断言 UI——en 资源已改动态加载，先恢复 en 测试环境。
beforeAll(() => setupI18nTestEnglish())

describe('SessionHeader', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useChatStore.setState({
      ...initialChatState,
      workspaceLabel: 'Working directory',
      activeThreadId: 'thread-1',
      threads: [{
        id: 'thread-1',
        title: 'Fix drag region',
        updatedAt: '2026-06-10T10:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'chat',
        workspace: '/workspace/deepseek-gui'
      }]
    })
  })

  afterEach(() => {
    useChatStore.setState(initialChatState)
  })

  it('keeps the compact session title area draggable in desktop shells', () => {
    const html = renderToStaticMarkup(createElement(SessionHeader, { compact: true }))

    expect(html).toContain('session-header-compact flex')
    expect(html).not.toContain('session-header-compact ds-no-drag')
    // renderToStaticMarkup 下 zustand 读初始快照（setState 不生效），无 active 会话时
    // 渲染的是 store 初始 workspaceLabel（模块求值语言下的 t('workingDirectory')）——
    // 断言引用快照值本身，不与语言绑定（R1 后默认语言为 zh）。
    expect(html).toContain(initialChatState.workspaceLabel)
  })
})
