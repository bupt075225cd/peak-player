import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

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
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path') ?? ''
    if (!filePath) return new Response('Bad Request', { status: 400 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
