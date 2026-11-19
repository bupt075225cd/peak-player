import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
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

function streamOf(path: string, options?: { start: number; end: number }): ReadableStream {
  const stream = options ? createReadStream(path, options) : createReadStream(path)
  return Readable.toWeb(stream) as unknown as ReadableStream
}

// 必须显式给出 MIME、Content-Length 与 Accept-Ranges：
// 缺了长度信息时 Chromium 会把 duration 判为 Infinity，进度与拖动都会失效
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

    const mime = mimeFor(filePath)
    const range = parseRange(request.headers.get('range'), size)

    if (range.kind === 'unsatisfiable') {
      return new Response('Range Not Satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${size}` }
      })
    }

    if (range.kind === 'partial') {
      return new Response(streamOf(filePath, { start: range.start, end: range.end }), {
        status: 206,
        headers: partialHeaders(mime, range.start, range.end, size)
      })
    }

    return new Response(streamOf(filePath), {
      status: 200,
      headers: fullHeaders(mime, size)
    })
  })
}
