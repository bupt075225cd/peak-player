import type { Track } from './types'

// 把 Track 转成可播放的 URL：本地走自定义 media 协议，远程留作扩展
export function resolveTrackUrl(track: Track): string {
  if (track.sourceType === 'remote') {
    // 以后扩展：返回对象存储签名 URL 或已缓存文件地址
    return track.path
  }
  return 'media://play?path=' + encodeURIComponent(track.path)
}
