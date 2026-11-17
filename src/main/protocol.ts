import { net, protocol } from 'electron'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

// 显式给出 MIME：变速产物是 flac，Chromium 对无 Content-Type 的流嗅探不可靠
const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg'
}

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

export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path') ?? ''
    if (!filePath) return new Response('Bad Request', { status: 400 })

    const res = await net.fetch(pathToFileURL(filePath).toString())
    const mime = MIME[extname(filePath).toLowerCase()]
    if (!mime) return res

    // 覆盖 Content-Type，同时保留状态码（Range 请求的 206）与其余响应头
    const headers = new Headers(res.headers)
    headers.set('content-type', mime)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
