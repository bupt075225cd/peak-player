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
  // 所属专辑；null 表示未分类
  albumId: string | null
}

// 专辑：实体内置，便于重命名与后续扩展封面/排序
export interface Album {
  id: string
  name: string
  // 专辑内曲目数，列表页直接展示，避免渲染进程二次统计
  trackCount: number
}

export interface DailyUsage {
  date: string
  seconds: number
}

export interface LyricLine {
  // 秒，原速时间轴（与 playerState.currentTime 同一口径），已叠加 offset
  time: number
  text: string
  // 同时间戳的第二行：双语 LRC 常把译文写成同一时间戳的下一行
  translation?: string
}

// sidecar = 歌曲同目录同名 .lrc；none = 没有可用歌词
export type LyricSource = 'sidecar' | 'none'

export interface LyricDoc {
  lines: LyricLine[]
  // 全局偏移（秒），来自 [offset:±ms]，正数表示整体延后显示
  offset: number
  source: LyricSource
}

// 变速预渲染结果：成功返回已生成文件路径，失败返回原因供渲染进程降级处理
export type VariantResult = { path: string } | { error: string }

export interface VariantProgress {
  trackPath: string
  rate: number
  ratio: number
}
