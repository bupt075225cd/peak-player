import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { getMainWindow, setQuitting } from './window'

let tray: Tray | null = null

export function createTray(): void {
  // 幂等：已有存活的托盘图标就复用，避免叠加出多个图标
  if (tray && !tray.isDestroyed()) return

  let icon = nativeImage.createEmpty()
  const loaded = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  if (!loaded.isEmpty()) icon = loaded

  tray = new Tray(icon)
  tray.setToolTip('Peak Player')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '播放/暂停',
        click: () => getMainWindow()?.webContents.send('player:toggle')
      },
      {
        label: '显示主界面',
        click: () => getMainWindow()?.show()
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          setQuitting(true)
          app.quit()
        }
      }
    ])
  )
  tray.on('click', () => getMainWindow()?.show())
}

// 主动销毁，避免进程退出后 Windows 托盘残留"幽灵图标"
export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
