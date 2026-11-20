import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { mediaStatus, parseMediaPath, unsatisfiableHeaders } from './media-request'
import { fullHeaders, mimeFor, parseRange, partialHeaders } from './range'

// 自定义协议：让渲染进程(开发态为 http://localhost)也能访问本地音频文件，
// 避免 Chromium 的 "Not allowed to load local resource" 限制。
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

export interface FileInfo {
  isFile(): boolean
  size: number
}

// 依赖注入：集成测试传入真实 fs（默认值），也可替换成桩来模拟 EACCES 等异常
export interface MediaResponseDeps {
  stat: (path: string) => Promise<FileInfo>
  createStream: (path: string, options?: { start: number; end: number }) => ReadableStream
}

function streamOf(path: string, options?: { start: number; end: number }): ReadableStream {
  const stream = options ? createReadStream(path, options) : createReadStream(path)
  return Readable.toWeb(stream) as unknown as ReadableStream
}

const defaultDeps: MediaResponseDeps = { stat, createStream: streamOf }

// 协议处理主体。刻意与 electron 解耦：只用 Web 标准 Request/Response + 注入的 fs，
// 这样「真实文件 → 状态码/头部/字节流」的整条链路能在集成测试里直接跑。
// 必须显式给出 MIME、Content-Length 与 Accept-Ranges：
// 缺了长度信息时 Chromium 会把 duration 判为 Infinity，进度与拖动都会失效
export async function createMediaResponse(
  request: Pick<Request, 'url' | 'headers'>,
  deps: Partial<MediaResponseDeps> = {}
): Promise<Response> {
  const { stat: statFile, createStream } = { ...defaultDeps, ...deps }

  const filePath = parseMediaPath(request.url)
  if (!filePath) return new Response('Bad Request', { status: 400 })

  let size: number
  try {
    const info = await statFile(filePath)
    if (!info.isFile()) return new Response('Not Found', { status: 404 })
    size = info.size
  } catch {
    return new Response('Not Found', { status: 404 })
  }

  const mime = mimeFor(filePath)
  const range = parseRange(request.headers.get('range'), size)
  const status = mediaStatus(range)

  if (status === 416) {
    return new Response('Range Not Satisfiable', {
      status,
      headers: unsatisfiableHeaders(size)
    })
  }

  if (status === 206 && range.kind === 'partial') {
    return new Response(createStream(filePath, { start: range.start, end: range.end }), {
      status,
      headers: partialHeaders(mime, range.start, range.end, size)
    })
  }

  return new Response(createStream(filePath), {
    status: 200,
    headers: fullHeaders(mime, size)
  })
}

export function registerMediaProtocol(): void {
  protocol.handle('media', (request) => createMediaResponse(request))
}
