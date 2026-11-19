export type SourceType = 'local' | 'remote'
export type LoopMode = 'none' | 'single' | 'all'
export type RankingBy = 'count' | 'duration'

export interface Track {
  id: string
  title: string
  path: string
  sourceType: SourceType
  playCount: number
  totalSeconds: number
  // 曲目真实时长（秒），播放时采集；改次数时按它换算用时
  duration: number
}

export interface DailyUsage {
  date: string
  seconds: number
}

// 变速预渲染结果：成功返回已生成文件路径，失败返回原因供渲染进程降级处理
export type VariantResult = { path: string } | { error: string }

export interface VariantProgress {
  trackPath: string
  rate: number
  ratio: number
}
