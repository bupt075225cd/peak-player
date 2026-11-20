// @vitest-environment happy-dom
// 组件级测试：真实挂载 .vue，用 DOM 事件驱动交互。
// 纯计算（二分定位、进度、滚动位置、挂起计时）已在 utils / composables 单测覆盖，
// 这里只验证组件把状态正确接到 DOM 上。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type Ref } from 'vue'
import type { LyricLine } from '../../../shared/types'
import { player, playerState } from '../core/player'
import LyricsPanel from './LyricsPanel.vue'

vi.mock('../core/player', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    playing: false,
    preparing: false,
    currentTime: 0,
    duration: 200,
    rate: 1,
    loopMode: 'none' as const,
    progress: 0,
    error: null as string | null,
    current: { id: '1', title: '测试歌曲' }
  })
  return {
    playerState: state,
    player: {
      displayTime: () => state.currentTime,
      seek: vi.fn(),
      toggle: vi.fn(),
      setRate: vi.fn()
    }
  }
})

const seek = vi.mocked(player.seek)

const LINES: LyricLine[] = [
  { time: 5, text: '第一句' },
  { time: 10, text: '第二句', translation: 'second line' },
  { time: 20, text: '第三句' }
]

let frame: (() => void) | null = null
let scrollTo: ReturnType<typeof vi.fn>
let mounted: { app: ReturnType<typeof createApp>; host: HTMLElement; lines: Ref<LyricLine[]> } | null

function mount(lines: LyricLine[]) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const linesRef = ref<LyricLine[]>(lines)
  const app = createApp({
    render: () => h(LyricsPanel, { lines: linesRef.value, onSeek: seek })
  })
  app.mount(host)
  mounted = { app, host, lines: linesRef }
  return mounted
}

beforeEach(() => {
  frame = null
  playerState.playing = false
  playerState.preparing = false
  playerState.currentTime = 0
  seek.mockClear()
  scrollTo = vi.fn()

  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollTo
  })
})

afterEach(() => {
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
  vi.unstubAllGlobals()
})

describe('LyricsPanel', () => {
  it('没有歌词时显示放置 .lrc 的引导', () => {
    const { host } = mount([])

    expect(host.textContent).toContain('暂无歌词')
    expect(host.textContent).toContain('.lrc')
    expect(host.querySelectorAll('.lyric-line')).toHaveLength(0)
  })

  it('渲染歌词、译文与当前行/已唱行标记', () => {
    playerState.currentTime = 12
    const { host } = mount([...LINES, { time: 30, text: '' }])

    expect(host.querySelectorAll('.lyric-line')).toHaveLength(4)
    expect(host.querySelector('.lyric-line.active')?.textContent).toContain('第二句')
    expect(host.querySelector('.lyric-line.sung')?.textContent).toContain('第一句')
    expect(host.textContent).toContain('second line')
    expect(host.textContent).toContain('♪')
  })

  it('前奏阶段（未到第一行）没有高亮行', () => {
    playerState.currentTime = 1
    const { host } = mount(LINES)

    expect(host.querySelector('.lyric-line.active')).toBeNull()
    expect(host.querySelector('.lyric-line.sung')).toBeNull()
  })

  it('点击歌词行跳到对应时间', async () => {
    const { host } = mount(LINES)

    ;(host.querySelectorAll('.lyric-line')[2] as HTMLElement).click()
    await nextTick()

    expect(seek).toHaveBeenCalledWith(20)
  })

  it('rAF 采样推进当前行并滚动跟随', async () => {
    playerState.currentTime = 5
    const { host } = mount(LINES)

    playerState.playing = true
    playerState.currentTime = 25
    expect(frame).toBeTypeOf('function')
    frame!()
    await nextTick()
    await nextTick()

    expect(host.querySelector('.lyric-line.active')?.textContent).toContain('第三句')
    expect(scrollTo).toHaveBeenCalled()
  })

  it('手动滚动后出现「回到当前歌词」，点击恢复跟随', async () => {
    playerState.currentTime = 12
    const { host } = mount(LINES)

    host.querySelector('.lyrics-viewport')!.dispatchEvent(new Event('wheel'))
    await nextTick()

    const back = host.querySelector('.lyrics-back') as HTMLElement
    expect(back.textContent).toContain('回到当前歌词')

    back.click()
    await nextTick()
    expect(host.querySelector('.lyrics-back')).toBeNull()
  })

  it('窗口尺寸变化时重新计算并跟随', () => {
    playerState.currentTime = 12
    mount(LINES)

    window.dispatchEvent(new Event('resize'))

    expect(scrollTo).toHaveBeenCalled()
  })

  it('换歌后歌词区回到顶部', async () => {
    playerState.currentTime = 12
    const { lines } = mount(LINES)

    scrollTo.mockClear()
    // 新歌词第一句远在当前时间之后，回到顶部后不应再自动跟随
    lines.value = [{ time: 100, text: '新歌' }]
    await nextTick()
    await nextTick()

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
