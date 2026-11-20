import { describe, expect, it, vi } from 'vitest'
import { normalizeSeekSeconds, useSeekDrag } from './useSeekDrag'

describe('normalizeSeekSeconds', () => {
  it('正常值原样返回', () => {
    expect(normalizeSeekSeconds(0)).toBe(0)
    expect(normalizeSeekSeconds(12.5)).toBe(12.5)
  })

  it('负数与非法值收敛到 0', () => {
    expect(normalizeSeekSeconds(-3)).toBe(0)
    expect(normalizeSeekSeconds(Number.NaN)).toBe(0)
    expect(normalizeSeekSeconds(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('useSeekDrag', () => {
  it('未拖动时展示当前播放时间', () => {
    let current = 10
    const drag = useSeekDrag({ getCurrentTime: () => current, seek: vi.fn() })

    expect(drag.dragging.value).toBe(false)
    expect(drag.displayTime.value).toBe(10)

    current = 30
    // 拖动状态变化会触发重新计算
    drag.update(30)
    drag.commit(30)
    expect(drag.displayTime.value).toBe(30)
  })

  it('拖动中展示拖动值，不受播放时间回写影响', () => {
    const current = 5
    const drag = useSeekDrag({ getCurrentTime: () => current, seek: vi.fn() })

    drag.update(42)

    expect(drag.dragging.value).toBe(true)
    expect(drag.dragTime.value).toBe(42)
    expect(drag.displayTime.value).toBe(42)
  })

  it('松手时按拖动值 seek 并回到跟随状态', () => {
    const seek = vi.fn()
    let current = 8
    const drag = useSeekDrag({ getCurrentTime: () => current, seek })

    drag.update(25)
    current = 25
    drag.commit(25)

    expect(seek).toHaveBeenCalledWith(25)
    expect(drag.dragging.value).toBe(false)
    expect(drag.displayTime.value).toBe(25)
  })

  it('非法拖动值按 0 处理，不会把进度条写成 NaN', () => {
    const seek = vi.fn()
    const drag = useSeekDrag({ getCurrentTime: () => 1, seek })

    drag.update(Number.NaN)
    expect(drag.dragTime.value).toBe(0)

    drag.update(-10)
    expect(drag.dragTime.value).toBe(0)

    drag.commit(Number.NaN)
    expect(seek).toHaveBeenCalledWith(0)
    expect(drag.dragging.value).toBe(false)
  })
})
