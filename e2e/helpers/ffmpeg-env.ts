import { FFMPEG } from '../../test/helpers/ffmpeg'

// 变速用例需要真的能跑 ffmpeg：
// - 有可用二进制（随包 resources/bin 或系统 PATH）→ 显式指定，确保走预渲染分支
// - 一个都没有（纯净 CI）→ 不设置，让应用自己降级，用例仍应通过
export function ffmpegEnv(): Record<string, string> {
  return FFMPEG.available ? { PEAK_FFMPEG: FFMPEG.path } : {}
}
