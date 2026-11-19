import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

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

// 必须显式给出 MIME、Content-Length 与 Accept-Ranges：
// 缺了长度信息时 Chromium 会把 duration 判为 Infinity，进度与拖动都会失效
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
}

function streamOf(path: string, options?: { start: number; end: number }): ReadableStream {
  const stream = options ? createReadStream(path, options) : createReadStream(path)
  return Readable.toWeb(stream) as unknown as ReadableStream
}

export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path') ?? ''
    if (!filePath) return new Response('Bad Request', { status: 400 })

    let size: number
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return new Response('Not Found', { status: 404 })
      size = info.size
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') ?? '').trim())

    if (range) {
      const [, startRaw, endRaw] = range
      let start = startRaw ? Number(startRaw) : 0
      let end = endRaw ? Number(endRaw) : size - 1
      // bytes=-N 表示请求末尾 N 字节
      if (!startRaw && endRaw) {
        start = Math.max(0, size - Number(endRaw))
        end = size - 1
      }
      start = Math.max(0, Math.min(start, size - 1))
      end = Math.max(start, Math.min(end, size - 1))

      return new Response(streamOf(filePath, { start, end }), {
        status: 206,
        headers: {
          'content-type': mime,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes'
        }
      })
    }

    return new Response(streamOf(filePath), {
      status: 200,
      headers: {
        'content-type': mime,
        'content-length': String(size),
        'accept-ranges': 'bytes'
      }
    })
  })
}
