import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
