import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 每个用例一个独立临时目录，afterEach 里统一清理：
// 集成测试会真的写文件/建库，不能复用固定路径
export interface TempDir {
  path: string
  file: (name: string) => string
  cleanup: () => void
}

export function makeTempDir(prefix = 'peak-test-'): TempDir {
  const path = mkdtempSync(join(tmpdir(), prefix))
  return {
    path,
    file: (name: string) => join(path, name),
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true })
      } catch {
        // Windows 上文件句柄未释放时删不掉，忽略
      }
    }
  }
}
