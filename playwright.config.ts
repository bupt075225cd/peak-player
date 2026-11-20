import { defineConfig } from '@playwright/test'

// E2E 直接驱动真实 Electron（主进程 + 渲染进程 + media:// 协议 + SQLite + ffmpeg），
// 因此必须先用 `npm run build` 产出 out/。详见 README「端到端测试」。
export default defineConfig({
  testDir: './e2e',
  // 每个用例都会真的启动一个 Electron 进程并写 userData，串行最稳
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'off'
  }
})
