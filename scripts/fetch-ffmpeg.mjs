// 下载带 rubberband 滤镜的 ffmpeg 到 resources/bin，供变速预渲染使用。
// 来源：ffmpeg-static 的 BtbN 静态构建（GPL 版，含 librubberband），走 npmmirror 镜像。
//
// 用法：
//   node scripts/fetch-ffmpeg.mjs                       # 当前平台
//   node scripts/fetch-ffmpeg.mjs --platform=win32 --arch=x64
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const TAG = process.env.FFMPEG_TAG ?? 'b6.1.1'
const BASE =
  process.env.FFMPEG_MIRROR ?? 'https://registry.npmmirror.com/-/binary/ffmpeg-static'

const args = new Map()
for (const raw of process.argv.slice(2)) {
  const [key, value] = raw.replace(/^--/, '').split('=')
  args.set(key, value ?? '')
}

const platform = args.get('platform') || process.platform
const arch = args.get('arch') || process.arch
const exeName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'bin', exeName)

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  console.log(`[fetch-ffmpeg] 已存在，跳过：${dest}`)
  process.exit(0)
}

const url = `${BASE}/${TAG}/ffmpeg-${platform}-${arch}.gz`
console.log(`[fetch-ffmpeg] 下载 ${url}`)

const res = await fetch(url)
if (!res.ok) {
  console.error(`[fetch-ffmpeg] 下载失败：HTTP ${res.status} ${res.statusText}`)
  process.exit(1)
}

const bin = gunzipSync(Buffer.from(await res.arrayBuffer()))
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, bin)
if (platform !== 'win32') chmodSync(dest, 0o755)

console.log(`[fetch-ffmpeg] 完成：${dest}（${(bin.length / 1048576).toFixed(1)} MB）`)
