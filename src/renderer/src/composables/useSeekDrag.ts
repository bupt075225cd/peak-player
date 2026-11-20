// 进度条拖动状态：拖动中展示拖动值，松手才 seek。
// 否则播放中的时间回写会把滑块一直拽回去，用户根本拖不动。
import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface SeekDragDeps {
  getCurrentTime: () => number
  seek: (seconds: number) => void
}

export interface SeekDrag {
  dragging: Ref<boolean>
  dragTime: Ref<number>
  displayTime: ComputedRef<number>
  // 拖动中（input 事件）
  update: (value: number) => void
  // 松手（change 事件）
  commit: (value: number) => void
}

// 进度条可能收到 NaN（空值/异常输入），越界也一律收敛到合法秒数
export function normalizeSeekSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

export function useSeekDrag(deps: SeekDragDeps): SeekDrag {
  const dragging = ref(false)
  const dragTime = ref(0)
  const displayTime = computed(() =>
    dragging.value ? dragTime.value : deps.getCurrentTime()
  )

  function update(value: number): void {
    dragging.value = true
    dragTime.value = normalizeSeekSeconds(value)
  }

  function commit(value: number): void {
    deps.seek(normalizeSeekSeconds(value))
    dragging.value = false
  }

  return { dragging, dragTime, displayTime, update, commit }
}
