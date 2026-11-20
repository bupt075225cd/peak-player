import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeWavBuffer } from '../../test/helpers/wav'

// 每个用例独占一个临时目录：userData（SQLite/变速缓存）+ 音频素材，
// 用例之间不共享状态，避免「上一条用例的播放次数」污染断言。
export interface AudioFixture {
  name: string
  seconds: number
}

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
  audioDir: string
  pathOf: (name: string) => string
  close: () => Promise<void>
}

export interface LaunchOptions {
  audio?: AudioFixture[]
  env?: Record<string, string>
  // 复用上一次的 userData，用于验证持久化
  userDataDir?: string
  rootDir?: string
}

const DEFAULT_AUDIO: AudioFixture[] = [
  { name: 'tone.wav', seconds: 3 },
  { name: 'short.wav', seconds: 1 }
]

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const rootDir = options.rootDir ?? mkdtempSync(join(tmpdir(), 'peak-e2e-'))
  const audioDir = join(rootDir, 'audio')
  const userDataDir = options.userDataDir ?? join(rootDir, 'userdata')
  const audio = options.audio ?? DEFAULT_AUDIO

  const { mkdirSync } = await import('node:fs')
  mkdirSync(audioDir, { recursive: true })

  for (const item of audio) {
    writeFileSync(join(audioDir, item.name), makeWavBuffer(item.seconds))
  }

  const app = await electron.launch({
    // cwd 决定加载 out/ 下的构建产物与 package.json 的 main 字段
    args: [
      '.',
      '--no-sandbox', // 容器/CI 里常以 root 运行，Chromium 沙箱会直接拒绝启动
      `--user-data-dir=${userDataDir}`,
      '--autoplay-policy=no-user-gesture-required'
    ],
    cwd: process.cwd(),
    env: { ...process.env, ...options.env }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const pathOf = (name: string): string => join(audioDir, name)

  return {
    app,
    page,
    userDataDir,
    audioDir,
    pathOf,
    close: async () => {
      await app.close()
      rmSync(rootDir, { recursive: true, force: true })
    }
  }
}

// 主进程里的系统文件选择框无法在无头环境操作，直接替换实现
export async function stubOpenDialog(app: ElectronApplication, files: string[]): Promise<void> {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected })
  }, files)
}

export async function stubCancelDialog(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
}

// ---- 页面操作 ----

export async function importFiles(app: ElectronApplication, page: Page, files: string[]): Promise<void> {
  await stubOpenDialog(app, files)
  await page.getByRole('button', { name: '导入音频文件' }).click()
}

export function rows(page: Page) {
  return page.locator('table tbody tr')
}

export function playRow(page: Page, index = 0) {
  return rows(page).nth(index).getByRole('button', { name: '播放' })
}

export function playCountCell(page: Page, index = 0) {
  return rows(page).nth(index).locator('td').nth(1)
}

export function playerBar(page: Page) {
  return page.locator('.player-bar')
}

// 播放条第一个按钮是「标题/歌词」入口，按文案精确定位播放键
export function playPauseButton(page: Page) {
  return playerBar(page).getByRole('button', { name: /^(播放|暂停)$/ })
}

// 播放条上的「当前时间 / 总时长」文本
export async function timeText(page: Page): Promise<string> {
  return (await playerBar(page).locator('.time').textContent()) ?? ''
}

export async function currentSeconds(page: Page): Promise<number> {
  const text = await timeText(page)
  const matched = /^(\d+):(\d+)/.exec(text.trim())
  if (!matched) return 0
  return Number(matched[1]) * 60 + Number(matched[2])
}

export async function totalSeconds(page: Page): Promise<number> {
  const text = await timeText(page)
  const matched = /\/\s*(\d+):(\d+)/.exec(text)
  if (!matched) return 0
  return Number(matched[1]) * 60 + Number(matched[2])
}

export async function selectRate(page: Page, rate: string): Promise<void> {
  await playerBar(page).locator('select').selectOption(rate)
}

export async function switchView(page: Page, name: '音乐库' | '排行榜' | '用时统计'): Promise<void> {
  await page.locator('.sidebar').getByRole('button', { name }).click()
}
