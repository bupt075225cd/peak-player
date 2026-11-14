import { app } from 'electron'
import { registerIpc } from './ipc'
import { registerMediaProtocol, registerSchemes } from './protocol'
import { createTray } from './tray'
import { createWindow, getMainWindow, setQuitting } from './window'

// 必须在 app ready 之前注册自定义协议 scheme
registerSchemes()

app.whenReady().then(() => {
  registerMediaProtocol()
  registerIpc()
  createWindow()
  createTray()

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
})
