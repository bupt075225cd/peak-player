// @vitest-environment happy-dom
// 组件级测试：影子跟读指南是纯展示内容，无外部依赖、无勾选状态
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import ShadowingView from './ShadowingView.vue'

let mounted: { app: ReturnType<typeof createApp>; host: HTMLElement } | null = null

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(ShadowingView)
  app.mount(host)
  mounted = { app, host }
  return host
}

afterEach(() => {
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
})

describe('ShadowingView', () => {
  it('渲染标题、五个步骤与关键要点', () => {
    const host = mount()
    const text = host.textContent ?? ''

    expect(host.querySelector('h2')?.textContent).toContain('影子跟读指南')
    expect(host.querySelectorAll('.shadowing-steps > li')).toHaveLength(5)
    expect(text).toContain('听两遍，先不看字幕')
    expect(text).toContain('看文本，扫清障碍')
    expect(text).toContain('暂停式模仿')
    expect(text).toContain('影子跟读')
    expect(text).toContain('脱口而出')
    expect(text).toContain('0.8 或 0.9 倍速')
    expect(text).toContain('抓重音')
    expect(text).toContain('模仿情绪')
  })

  it('第 2 步只保留扫清障碍，不再提示标注连读弱读', () => {
    const host = mount()
    const second = host.querySelectorAll('.shadowing-steps > li')[1]
    const text = second.textContent ?? ''

    expect(text).toContain('对照原文确认生词和意思')
    expect(text).not.toContain('连读')
  })

  // 用户明确要求：只展示步骤，不做勾选
  it('纯展示：没有任何勾选控件', () => {
    const host = mount()

    expect(host.querySelectorAll('input')).toHaveLength(0)
  })
})
