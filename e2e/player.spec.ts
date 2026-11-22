import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { ffmpegEnv } from './helpers/ffmpeg-env'
import {
  currentSeconds,
  importFiles,
  launchApp,
  playCountCell,
  playPauseButton,
  playRow,
  playerBar,
  rows,
  selectRate,
  totalSeconds
} from './helpers/app'

// E2E：播放引擎在真实 Chromium 媒体栈上的行为（变速、循环计数、错误兜底）。

test('单曲循环：播放结束自动重播并累加次数', async () => {
  // short.wav 只有 1 秒，方便在一次用例里跑完若干轮
  const ctx = await launchApp({ audio: [{ name: 'short.wav', seconds: 1 }] })
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('short.wav')])
    await playRow(ctx.page).click()
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')

    // ended 后计数 +1 并自动重播，因此会持续增长
    await expect
      .poll(async () => Number(await playCountCell(ctx.page).textContent()), { timeout: 20000 })
      .toBeGreaterThanOrEqual(1)

    // 仍在播放（重播生效），说明没有走 audio.loop 而是手动重播
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
  } finally {
    await ctx.close()
  }
})

test('切到 1.25x：继续播放且不重置进度', async () => {
  const ctx = await launchApp({
    audio: [{ name: 'tone.wav', seconds: 6 }],
    env: { PEAK_FFMPEG: process.env['PEAK_FFMPEG'] ?? '/usr/bin/ffmpeg' }
  })
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()
    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThan(1)

    const before = await currentSeconds(ctx.page)
    await selectRate(ctx.page, '1.25')

    // 生成期间若出现进度提示，最终必须消失
    await expect(playerBar(ctx.page).locator('.prep')).toHaveCount(0)
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
    await expect(playerBar(ctx.page).locator('.error')).toHaveCount(0)

    // 展示时间轴是「原速时间」：切倍速不应回零，也不该跳变过大
    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThanOrEqual(before)
    // 总时长保持原速时长（3s 源 → 仍是 3s，而不是变速后的 2.4s）
    await expect.poll(() => totalSeconds(ctx.page)).toBe(6)
  } finally {
    await ctx.close()
  }
})

test('ffmpeg 不可用时降级为内置伸缩：不报错、继续播放', async () => {
  const ctx = await launchApp({
    audio: [{ name: 'tone.wav', seconds: 4 }],
    // 指向不存在的可执行文件，模拟「安装包缺 ffmpeg / 被杀软隔离」
    env: { PEAK_FFMPEG: '/nonexistent/ffmpeg-does-not-exist' }
  })
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()
    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThan(0)

    await selectRate(ctx.page, '1.5')

    // 用户视角：没有弹错、没有卡死，仍然在播
    await expect(playerBar(ctx.page).locator('.error')).toHaveCount(0)
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
    const afterSwitch = await currentSeconds(ctx.page)
    await expect.poll(() => currentSeconds(ctx.page), { timeout: 15000 }).toBeGreaterThan(afterSwitch)

    // 再次切倍速不应无限重试 ffmpeg（variantDisabled 生效），界面依旧正常
    await selectRate(ctx.page, '1.25')
    await expect(playPauseButton(ctx.page)).toHaveText('暂停')
    await expect(playerBar(ctx.page).locator('.error')).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test('歌词：同名 .lrc 在播放条与全屏页展示，Esc 收起', async () => {
  const ctx = await launchApp({ audio: [{ name: 'tone.wav', seconds: 30 }] })
  try {
    // 歌词与音频同目录同名；第二句放到 20s 之后，避免断言期间串行
    writeFileSync(
      ctx.pathOf('tone.lrc'),
      '[ti:测试]\n[00:00.50]第一句\n[00:20.00]第二句\n',
      'utf8'
    )

    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()

    await expect(playerBar(ctx.page).locator('.title-lyric')).toContainText('第一句')

    await ctx.page.getByRole('button', { name: '字幕', exact: true }).click()
    const overlay = ctx.page.locator('.now-playing')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('.lyric-line')).toHaveCount(2)
    await expect(overlay.locator('.lyric-line.active')).toContainText('第一句')

    // 点击歌词行跳转，仍保持在歌词页
    await overlay.locator('.lyric-line').nth(1).click()
    await expect(overlay).toBeVisible()

    await ctx.page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test('歌词页：手动滚动暂停跟随，拖动进度条联动高亮', async () => {
  const ctx = await launchApp({ audio: [{ name: 'tone.wav', seconds: 60 }] })
  try {
    writeFileSync(
      ctx.pathOf('tone.lrc'),
      '[00:00.50]第一句\n[00:05.00]第二句\n[00:30.00]第三句\n',
      'utf8'
    )

    await importFiles(ctx.app, ctx.page, [ctx.pathOf('tone.wav')])
    await playRow(ctx.page).click()
    await ctx.page.getByRole('button', { name: '字幕', exact: true }).click()

    const overlay = ctx.page.locator('.now-playing')
    const viewport = overlay.locator('.lyrics-viewport')
    const back = overlay.getByRole('button', { name: '回到当前歌词' })
    await expect(viewport).toBeVisible()

    // 手动滚动后暂停自动跟随（4 秒内恢复），出现「回到当前歌词」
    await viewport.hover()
    await ctx.page.mouse.wheel(0, 400)
    await expect(back).toBeVisible()

    await back.click()
    await expect(back).toHaveCount(0)

    // 拖动进度条到 30s：当前高亮切到第三句
    await overlay.locator('.np-range').evaluate((el) => {
      const input = el as HTMLInputElement
      input.value = '30'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await expect.poll(() => currentSeconds(ctx.page)).toBeGreaterThanOrEqual(25)
    await expect(overlay.locator('.lyric-line.active')).toContainText('第三句')
  } finally {
    await ctx.close()
  }
})

test('文件被移走后播放给出可读错误而不是卡死', async () => {
  const ctx = await launchApp({ audio: [{ name: 'gone.wav', seconds: 2 }] })
  try {
    await importFiles(ctx.app, ctx.page, [ctx.pathOf('gone.wav')])
    await expect(rows(ctx.page)).toHaveCount(1)

    const { rmSync } = await import('node:fs')
    rmSync(ctx.pathOf('gone.wav'))

    await playRow(ctx.page).click()

    await expect(playerBar(ctx.page).locator('.error')).toBeVisible()
    await expect(playPauseButton(ctx.page)).toHaveText('播放')
  } finally {
    await ctx.close()
  }
})
