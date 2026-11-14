// 用 electron-as-node 运行 vitest，确保 better-sqlite3 使用与运行时一致的
// electron ABI（避免 node 与 electron 的 NODE_MODULE_VERSION 不匹配）。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
// require('electron') 在普通 Node 下返回 electron 可执行文件的路径
const electronPath = require('electron')

const vitestBin = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const vitestArgs = process.argv.slice(2)
const args = [vitestBin, ...(vitestArgs.length > 0 ? vitestArgs : ['run'])]

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

child.on('error', (err) => {
  console.error('Failed to run tests:', err)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
