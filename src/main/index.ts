import { app } from 'electron'
import { registerIpc } from './ipc'
import { registerMediaProtocol, registerSchemes } from './protocol'
import { createTray, destroyTray } from './tray'
import { pruneVariantCache } from './transcode'
import { createWindow, getMainWindow, setQuitting } from './window'

// 单实例锁：重复启动会再建一个托盘图标和窗口，必须阻止
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // 第二次启动：把已运行的实例唤到前台，而不是新建进程
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (!win) {
      createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // 必须在 app ready 之前注册自定义协议 scheme
  registerSchemes()

  app.whenReady().then(() => {
    registerMediaProtocol()
    registerIpc()
    createWindow()
    createTray()

    // 变速缓存清理放到空闲时执行，不阻塞窗口显示
    setTimeout(() => pruneVariantCache(), 5000)

    app.on('activate', () => {
      const win = getMainWindow()
      if (win === null) createWindow()
      else win.show()
    })
  })

  // 后台驻留：所有窗口关闭时不退出进程，音频继续播放
  app.on('window-all-closed', () => {
    // 不调用 app.quit()，进程常驻托盘
  })

  app.on('before-quit', () => {
    setQuitting(true)
    destroyTray()
  })
}
