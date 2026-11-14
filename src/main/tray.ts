import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { getMainWindow, setQuitting } from './window'

let tray: Tray | null = null

export function createTray(): void {
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
