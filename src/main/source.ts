import type { SourceType, Track } from '../shared/types'

// 音源抽象层：本地与远程（对象存储）统一接入点。
// 以后接入 COS / OSS / S3 时，只需实现 RemoteSource，播放/计数/统计逻辑零改动。
export interface TrackSource {
  sourceType: SourceType
  resolvePlayableUrl(): Promise<string>
}

export class LocalSource implements TrackSource {
  sourceType: SourceType = 'local'

  constructor(public path: string) {}

  async resolvePlayableUrl(): Promise<string> {
    return 'media://play?path=' + encodeURIComponent(this.path)
  }
}

export class RemoteSource implements TrackSource {
  sourceType: SourceType = 'remote'

  constructor(
    public objectKey: string,
    private provider?: unknown // 以后放 CosClient / OssClient / S3Client 实例
  ) {}

  async resolvePlayableUrl(): Promise<string> {
    // TODO: 下载到临时目录后返回 media:// 地址，或返回带签名的对象存储 URL
    throw new Error('Remote source not implemented yet')
  }
}

export function createSource(track: Track): TrackSource {
  if (track.sourceType === 'remote') return new RemoteSource(track.path)
  return new LocalSource(track.path)
}
