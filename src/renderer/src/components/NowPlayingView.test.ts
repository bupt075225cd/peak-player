// @vitest-environment happy-dom
// 组件级测试：真实挂载全屏歌词页，验证开关、底部控制与键盘交互。
// 播放引擎被 mock 成响应式状态，事件回调直接落到 mock 上。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { nextTrack, player, playerState, prevTrack } from '../core/player'
import { useLibraryStore } from '../stores/library'
import NowPlayingView from './NowPlayingView.vue'

vi.mock('../core/player', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    playing: false,
    preparing: false,
    currentTime: 42,
    duration: 200,
    rate: 1,
    loopMode: 'none' as 'none' | 'single' | 'all',
    progress: 0,
    error: null as string | null,
    current: { id: '1', title: '测试歌曲' } as { id: string; title: string } | null
  })
  return {
    playerState: state,
    player: {
      displayTime: () => state.currentTime,
      seek: vi.fn(),
      toggle: vi.fn(),
      setRate: vi.fn(),
      get loopMode() {
        return state.loopMode
      },
      set loopMode(value: 'none' | 'single' | 'all') {
        state.loopMode = value
      }
    },
    nextTrack: vi.fn(),
    prevTrack: vi.fn()
  }
})

const seek = vi.mocked(player.seek)
const setRate = vi.mocked(player.setRate)
const next = vi.mocked(nextTrack)
const prev = vi.mocked(prevTrack)

let mounted: { app: ReturnType<typeof createApp>; host: HTMLElement } | null
let onClose: ReturnType<typeof vi.fn>

function mount(open: boolean) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const openRef = ref(open)
  const pinia = createPinia()
  const app = createApp({
    render: () => h(NowPlayingView, { open: openRef.value, onClose })
  })
  app.use(pinia)
  app.mount(host)
  mounted = { app, host }
  return { ...mounted, openRef, pinia }
}

beforeEach(() => {
  playerState.playing = false
  playerState.preparing = false
  playerState.currentTime = 42
  playerState.rate = 1
  playerState.loopMode = 'none'
  playerState.progress = 0
  playerState.error = ''
  playerState.current = {
    id: '1',
    title: '测试歌曲',
    path: '/music/a.mp3',
    sourceType: 'local',
    playCount: 0,
    totalSeconds: 0,
    duration: 200
  }
  seek.mockClear()
  setRate.mockClear()
  next.mockClear()
  prev.mockClear()
  onClose = vi.fn()

  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn()
  })
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
  vi.unstubAllGlobals()
})

describe('NowPlayingView', () => {
  it('关闭状态不渲染浮层，打开后渲染', async () => {
    const { host, openRef } = mount(false)
    expect(host.querySelector('.now-playing')).toBeNull()

    openRef.value = true
    await nextTick()

    expect(host.querySelector('.now-playing')).not.toBeNull()
  })

  it('展示标题、时间与控制项', () => {
    const { host } = mount(true)
    const text = host.textContent ?? ''

    expect(text).toContain('正在播放')
    expect(text).toContain('测试歌曲')
    expect(text).toContain('收起')
    expect(text).toContain('倍速')
    expect(text).toContain('顺序播放')
    expect(text).toContain('0:42')
    expect(text).toContain('3:20')
    expect(text).toContain('暂无歌词')
  })

  // 空列表时没有可切的目标，按钮应禁用；有曲目后点击才真正切歌
  it('上/下一曲按钮：空库禁用，有曲目时触发切换', async () => {
    const { host, pinia } = mount(true)
    await nextTick()

    const buttons = (): HTMLButtonElement[] => [
      ...host.querySelectorAll<HTMLButtonElement>('.np-controls button')
    ]
    const buttonOf = (label: string): HTMLButtonElement =>
      buttons().find((b) => b.textContent?.trim() === label)!

    expect(buttonOf('上一曲').disabled).toBe(true)
    expect(buttonOf('下一曲').disabled).toBe(true)

    const library = useLibraryStore(pinia)
    library.tracks = [
      {
        id: '1',
        title: 'A',
        path: '/a.mp3',
        sourceType: 'local',
        playCount: 0,
        totalSeconds: 0,
        duration: 10
      }
    ]
    await nextTick()

    buttonOf('上一曲').click()
    buttonOf('下一曲').click()

    expect(prev).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('没有当前曲目时标题显示未在播放', async () => {
    playerState.current = null
    const { host } = mount(true)
    await nextTick()

    expect(host.textContent).toContain('未在播放')
  })

  it('Esc 关闭浮层', () => {
    mount(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('非 Esc 按键不关闭', () => {
    mount(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('拖动进度条时显示拖动值，松手才 seek', async () => {
    const { host } = mount(true)
    const range = host.querySelector('.np-range') as HTMLInputElement

    range.value = '30'
    range.dispatchEvent(new Event('input'))
    await nextTick()

    expect(host.textContent).toContain('0:30')
    expect(seek).not.toHaveBeenCalled()

    range.dispatchEvent(new Event('change'))
    expect(seek).toHaveBeenCalledWith(30)
  })

  it('切换倍速调用引擎', () => {
    const { host } = mount(true)
    const select = host.querySelector('.np-rate select') as HTMLSelectElement

    select.value = '1.25'
    select.dispatchEvent(new Event('change'))

    expect(setRate).toHaveBeenCalledWith(1.25)
  })

  it('循环按钮按顺序切换模式并更新文案', async () => {
    const { host } = mount(true)
    const loopButton = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('顺序播放')
    ) as HTMLButtonElement

    loopButton.click()
    await nextTick()

    expect(playerState.loopMode).toBe('single')
    expect(host.textContent).toContain('单曲循环')
  })

  it('变速预渲染与错误提示互斥', async () => {
    playerState.preparing = true
    playerState.progress = 0.5
    const { host } = mount(true)

    expect(host.textContent).toContain('正在生成 1x 音频')
    expect(host.querySelector('.np-error')).toBeNull()

    playerState.preparing = false
    playerState.error = '音频加载失败'
    await nextTick()

    expect(host.textContent).toContain('音频加载失败')
    expect(host.textContent).not.toContain('正在生成')
  })
})
