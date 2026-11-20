// 打包产物冒烟：确认安装包里真的带上了「能执行、且含 rubberband」的 ffmpeg。
//
// 为什么需要单独一步：ffmpeg 二进制不进仓库，靠 scripts/fetch-ffmpeg.mjs 在打包前下载。
// 一旦下载被跳过（直接 electron-builder）、平台参数写错（如 macOS 包塞了 win32 二进制）、
// 或 extraResources 配置被改动，electron-builder 往往只 warn 一句照样出包，
// 用户装完才发现变速不可用。这里把「包里有文件」和「文件能跑」都验一遍。
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

// PEAK_RELEASE_DIR 只用于测试：让冒烟脚本跑在构造出来的假产物目录上
const RELEASE = process.env['PEAK_RELEASE_DIR']
  ? resolve(process.env['PEAK_RELEASE_DIR'])
  : join(process.cwd(), 'release')
const MIN_BYTES = 1_000_000 // 完整的静态 ffmpeg 约 80MB，小于 1MB 基本是下载/解压失败的残骸

const FFMPEG_NAMES = new Set(['ffmpeg', 'ffmpeg.exe'])

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

// 在 release/ 下找所有 resources/bin/ffmpeg*（win-unpacked / linux-unpacked / mac/*.app 均适用）
function scan(dir, found = [], depth = 0) {
  if (depth > 6) return found
  for (const entry of listDir(dir)) {
    if (!entry.isDirectory()) continue
    // asar 解包目录里是原生模块，跳过以免无谓遍历
    if (entry.name === 'app.asar.unpacked') continue

    const full = join(dir, entry.name)
    if (entry.name === 'bin') {
      for (const file of listDir(full)) {
        if (file.isFile() && FFMPEG_NAMES.has(file.name)) found.push(join(full, file.name))
      }
      continue
    }
    scan(full, found, depth + 1)
  }
  return found
}

// release/win-unpacked/resources/bin/ffmpeg.exe → release/win-unpacked
function artifactOf(file) {
  const binDir = dirname(file) // .../resources/bin
  const resources = dirname(binDir) // .../resources
  return dirname(resources) // .../<artifact>
}

function platformOf(file, artifact) {
  if (file.endsWith('.exe')) return 'win32'
  if (/win/.test(artifact)) return 'win32'
  if (artifact.includes('.app') || /(^|[\\/])mac(-|$)/.test(artifact)) return 'darwin'
  if (/linux/.test(artifact)) return 'linux'
  return 'unknown'
}

const pad = (text, width) => String(text).padEnd(width)

const rows = []
const failures = []

const artifacts = listDir(RELEASE).filter((entry) => entry.isDirectory())
if (artifacts.length === 0) {
  console.error(`!! 没有找到打包产物（${RELEASE}）`)
  console.error('   请先执行 npm run package:win / package:mac / package:linux')
  process.exit(1)
}

const found = scan(RELEASE)

for (const file of found) {
  const artifact = artifactOf(file)
  const platform = platformOf(file, artifact)
  const label = relative(process.cwd(), artifact)

  let size = 0
  try {
    size = statSync(file).size
  } catch {
    // 保留 size = 0，走失败分支
  }

  const problems = []
  if (size < MIN_BYTES) problems.push(`体积异常（${size} 字节）`)

  const expectedName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  if (basename(file) !== expectedName) {
    problems.push(`文件名应为 ${expectedName}（交叉打包时下错了平台）`)
  }

  // 只有宿主平台才谈得上「能不能跑」；交叉打包的产物只校验存在与体积
  let runnable = 'skip(非宿主平台)'
  if (platform === process.platform && size >= MIN_BYTES) {
    const version = spawnSync(file, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 20000 })
    if (version.status !== 0) {
      runnable = 'fail'
      problems.push(`无法执行 -version：${(version.stderr || version.error?.message || '').trim().slice(0, 120)}`)
    } else {
      const filters = spawnSync(file, ['-hide_banner', '-filters'], {
        encoding: 'utf8',
        timeout: 20000
      })
      if (filters.status !== 0 || !/rubberband/.test(filters.stdout ?? '')) {
        runnable = 'fail'
        problems.push('缺少 rubberband 滤镜（变速会退回内置伸缩，音质下降）')
      } else {
        runnable = 'ok'
      }
    }
  }

  rows.push({ label, platform, name: relative(artifact, file), size, runnable })
  for (const problem of problems) failures.push(`${label}：${problem}`)
}

if (found.length === 0) {
  const names = artifacts.map((entry) => entry.name).join(', ')
  failures.push(`打包产物（${names}）里没有 resources/bin/ffmpeg —— 检查 extraResources 与 fetch-ffmpeg`)
}

console.log('\n打包产物冒烟（ffmpeg 是否随包、是否可执行）')
console.log(
  `${pad('产物目录', 34)}${pad('平台', 9)}${pad('文件名', 26)}${pad('体积', 12)}可执行`
)
for (const row of rows) {
  const size = `${(row.size / 1048576).toFixed(1)}MB`
  console.log(
    `${pad(row.label, 34)}${pad(row.platform, 9)}${pad(row.name, 26)}${pad(size, 12)}${row.runnable}`
  )
}

if (failures.length > 0) {
  console.error('\n!! 打包产物冒烟未通过：')
  for (const line of failures) console.error(`   - ${line}`)
  process.exit(1)
}

console.log('\n打包产物冒烟通过')
