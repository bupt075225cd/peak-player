import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let win: BrowserWindow | null = null
let isQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return win
}

export function setQuitting(v: boolean): void {
  isQuitting = v
}

export function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    title: 'Peak Player',
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())

  // 关键：关闭窗口时隐藏而非销毁，保证后台播放不中断
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  // 关键：禁止后台 CPU 节流，避免最小化后音频卡顿
  win.webContents.setBackgroundThrottling(false)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
