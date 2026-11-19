import { configDefaults, defineConfig } from 'vitest/config'

// 本地 glibc < 2.29 时 better-sqlite3 的原生模块加载不了（会报 GLIBC_2.29 not found），
// 设 PEAK_SKIP_DB=1 可跳过数据库用例，其余测试照常跑；CI 与远程机始终跑全量。
const skipDb = process.env.PEAK_SKIP_DB === '1'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...(skipDb ? ['src/main/db.test.ts'] : [])],
    // 单线程运行，避免 db 模块级单例在多 worker 间状态冲突
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,vue}'],
      // 测试文件、类型声明与纯类型模块没有可执行代码，不计入分母
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/shared/types.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage'
    }
  }
})
