import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  currentSeconds,
  importFiles,
  launchApp,
  playerBar,
  playCountCell,
  playPauseButton,
  playRow,
  rows,
  stubCancelDialog,
  switchView,
  totalSeconds
} from './helpers/app'

// E2E：真实 Electron 主进程 + 渲染进程 + media:// 协议 + SQLite。
// 前置：npm run build（out/ 下要有构建产物）。

test('冷启动：空库提示与窗口标题', async () => {
  const ctx = await launchApp()
  try {
    await expect(ctx.page).toHaveTitle('Peak Player')
    await expect(ctx.page.getByRole('heading', { name: '播放列表' })).toBeVisible()
    await expect(ctx.page.locator('.empty')).toContainText('暂无歌曲')
    await expect(ctx.page.locator('.player-bar .title')).toHaveText('未在播放')
  } finally {
    await ctx.close()
  }
})

test('安全面：只暴露白名单 api，渲染进程没有 Node 能力', async () => {
  const ctx = await launchApp()
  try {
    const surface = await ctx.page.evaluate(() => ({
      keys: Object.keys(window.api ?? {}).sort(),
      hasRequire: typeof (window as unknown as { require?: unknown }).require,
      hasProcess: typeof (window as unknown as { process?: unknown }).process,
      hasIpc: 'ipcRenderer' in window
    }))

    expect(surface.keys).toEqual([
      'addUsage',
      'getLyrics',
      'getRanking',
      'getWeeklyUsage',
      'importFiles',
      'incrementCount',
      'listTracks',
      'onTogglePlay',
      'onVariantProgress',
      'prepareVariant',
      'setTrackDuration',
      'updateTrack'
    ])
    expect(surface.hasRequire).toBe('undefined')
    expect(surface.hasProcess).toBe('undefined')
    expect(surface.hasIpc).toBe(false)
  } finally {
    await ctx.close()
  }
})

test('导入音频：按扩展名过滤，取消选择不写入', async () => {
  const ctx = await launchApp()
  try {
    // 先验证取消
    await stubCancelDialog(ctx.app)
    await ctx.page.getByRole('button', { name: '导入音频文件' }).click()
    await expect(ctx.page.locator('.empty')).toBeVisible()

    // 再导入：wma 不在白名单
    await importFiles(ctx.app, ctx.page, [
      ctx.pathOf('tone.wav'),
      join(ctx.audioDir, 'unsupported.wma'),
      ctx.pathOf('short.wav')
    ])

    await expect(rows(ctx.page)).toHaveCount(2)
    // 按标题升序：short 在 tone 之前
    await expect(rows(ctx.page).nth(0)).toContainText('short')
    await expect(rows(ctx.page).nth(1)).toContainText('tone')

    // 再导入同一批文件：按 path 去重，不应出现重复行
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav'), ctx.pathOf('short.wav')])
    await expect(rows(ctx.page)).toHaveCount(2)
  } finally {
    await ctx.close()
  }
})

test('播放：加载出真实时长并推进播放进度', async () => {
  const ctx = await launchApp()
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await expect(rows(ctx.page)).toHaveCount(1)

    await playRow(ctx.page).click()

    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
    // 时长来自 media:// 的 content-length，缺了就是 Infinity/0:00
    await expect.poll(() => totalSeconds(ctx.page)).toBe(3)
    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThan(0)
    await expect(playerBar(ctx.page).locator('.error')).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test('关闭窗口后进程驻留，音频继续播放', async () => {
  // 用足够长的素材：3 秒的曲子会在断言期间播完并因单曲循环回到 0:00
  const ctx = await launchApp({ audio: [{ name: 'tone.wav', seconds: 30 }] })
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()
    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThan(0)

    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })

    // 窗口只是隐藏，没有销毁，音频继续走
    const before = await currentSeconds(ctx.page)
    await ctx.page.waitForTimeout(1500)
    const state = await ctx.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return { visible: win?.isVisible(), destroyed: win?.isDestroyed(), count: BrowserWindow.getAllWindows().length }
    })

    expect(state.count).toBe(1)
    expect(state.visible).toBe(false)
    expect(state.destroyed).toBe(false)
    expect(await currentSeconds(ctx.page)).toBeGreaterThan(before)

    // 托盘「显示主界面」走的是同一个 show()
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show()
    })
    await expect(ctx.page.locator('.player-bar')).toBeVisible()
  } finally {
    await ctx.close()
  }
})

test('托盘播放/暂停通道能切换播放状态', async () => {
  const ctx = await launchApp()
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')

    // 托盘菜单项点击后发送的就是这个通道
    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('player:toggle')
    })
    await expect(playPauseButton(ctx.page)).toHaveText('播放')

    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('player:toggle')
    })
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
  } finally {
    await ctx.close()
  }
})

test('改次数会联动排行榜与用时统计', async () => {
  const ctx = await launchApp()
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await expect(rows(ctx.page)).toHaveCount(1)

    await rows(ctx.page).first().getByRole('button', { name: '改次数' }).click()
    const input = ctx.page.locator('input.count-input')
    await input.fill('3')
    await input.press('Enter')

    await expect(playCountCell(ctx.page)).toHaveText('3')

    await switchView(ctx.page, '排行榜')
    await expect(ctx.page.locator('.ranking li')).toHaveCount(1)
    await expect(ctx.page.locator('.ranking li').first()).toContainText('3 次')

    await ctx.page.getByRole('button', { name: '按时长' }).click()
    await expect(ctx.page.locator('.ranking li')).toHaveCount(1)

    await switchView(ctx.page, '用时统计')
    await expect(ctx.page.locator('canvas')).toHaveCount(1)
  } finally {
    await ctx.close()
  }
})

test('重启后播放次数与用时统计仍在', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'peak-persist-'))
  const userDataDir = join(rootDir, 'userdata')

  const first = await launchApp({ rootDir, userDataDir })
  try {
    await importFiles(first.app, first.page, [first.pathOf('tone.wav')])
    await rows(first.page).first().getByRole('button', { name: '改次数' }).click()
    const input = first.page.locator('input.count-input')
    await input.fill('4')
    await input.press('Enter')
    await expect(playCountCell(first.page)).toHaveText('4')
  } finally {
    // 只关进程，保留 userData
    await first.app.close()
  }

  const second = await launchApp({ rootDir, userDataDir })
  try {
    await expect(rows(second.page)).toHaveCount(1)
    await expect(playCountCell(second.page)).toHaveText('4')
  } finally {
    await second.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('单实例：重复启动会被已有实例接管后退出', async () => {
  const ctx = await launchApp()
  try {
    // Playwright 把 spec 编译成 CJS，这里用 __filename 构造 require
    const localRequire = createRequire(__filename)
    const electronPath = localRequire('electron') as unknown as string

    const exitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(
        electronPath,
        ['.', '--no-sandbox', `--user-data-dir=${ctx.userDataDir}`],
        { cwd: process.cwd(), stdio: 'ignore' }
      )
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve(null)
      }, 20000)
      child.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    expect(exitCode).toBe(0)
    const windowCount = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    expect(windowCount).toBe(1)
  } finally {
    await ctx.close()
  }
})
