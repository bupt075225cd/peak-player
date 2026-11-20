// 下载带 rubberband 滤镜的 ffmpeg 到 resources/bin，供变速预渲染使用。
// 来源：ffmpeg-static 的 BtbN 静态构建（GPL 版，含 librubberband），走 npmmirror 镜像。
//
// 用法：
//   node scripts/fetch-ffmpeg.mjs                       # 当前平台
//   node scripts/fetch-ffmpeg.mjs --platform=win32 --arch=x64
import { spawnSync } from 'node:child_process'
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

// 校验二进制真的能用：只有带 rubberband 的 ffmpeg 才满足变速需求。
// 缓存恢复的、或从镜像下到的残骸都可能「文件在但不可用」，
// 那种情况下单测会静默跳过 transcode 用例，覆盖率悄悄掉一档。
function verify(path) {
  const result = spawnSync(path, ['-hide_banner', '-filters'], { encoding: 'utf8', timeout: 20000 })
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `退出码 ${result.status}`
    console.error(`[fetch-ffmpeg] 无法执行 ${path}：${reason}`)
    return false
  }
  if (!/rubberband/.test(result.stdout ?? '')) {
    console.error(`[fetch-ffmpeg] ${path} 缺少 rubberband 滤镜，变速会退回内置伸缩`)
    return false
  }
  return true
}

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  // 交叉目标的二进制无法在宿主上执行，只校验存在性
  if (platform !== process.platform) {
    console.log(`[fetch-ffmpeg] 已存在（交叉目标 ${platform}，跳过执行校验）：${dest}`)
    process.exit(0)
  }
  if (!verify(dest)) process.exit(1)
  console.log(`[fetch-ffmpeg] 已存在且可用，跳过下载：${dest}`)
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

const size = `${(bin.length / 1048576).toFixed(1)} MB`
if (platform !== process.platform) {
  console.log(`[fetch-ffmpeg] 完成（交叉目标 ${platform}，跳过执行校验）：${dest}（${size}）`)
  process.exit(0)
}
if (!verify(dest)) process.exit(1)

console.log(`[fetch-ffmpeg] 完成：${dest}（${size}）`)
