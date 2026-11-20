// 覆盖率基线校验：读取 vitest 生成的 coverage/coverage-summary.json，
// 按模块（目录）加权聚合后与 scripts/coverage-baseline.json 比较。
// 任一指标低于基线即以非零码退出，供 pre-commit / pre-push 拦截。
import { readFileSync } from 'node:fs'
import path from 'node:path'

const METRICS = ['statements', 'branches', 'functions', 'lines']
const LABELS = { statements: '语句', branches: '分支', functions: '函数', lines: '行' }

const SUMMARY = path.join(process.cwd(), 'coverage', 'coverage-summary.json')
const BASELINE = path.join(process.cwd(), 'scripts', 'coverage-baseline.json')

function readJson(file, missingHint) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    console.error(`!! ${missingHint}（${file}）`)
    process.exit(1)
  }
}

const round2 = (value) => Math.round(value * 100) / 100

const summary = readJson(SUMMARY, '未找到覆盖率报告，请先执行 npm run test:coverage')
const baseline = readJson(BASELINE, '未找到覆盖率基线文件')
const modules = baseline.modules ?? {}

// istanbul 风格的 summary 里，除 total 外每个键都是文件的绝对路径
const entries = Object.keys(summary)
  .filter((key) => key !== 'total')
  .map((key) => ({ key, path: key.split(path.sep).join('/') }))

function aggregate(prefix) {
  const targets = prefix ? entries.filter((entry) => entry.path.includes(prefix)) : entries
  const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]))

  for (const { key } of targets) {
    for (const metric of METRICS) {
      const data = summary[key]?.[metric]
      if (!data) continue
      totals[metric].covered += data.covered
      totals[metric].total += data.total
    }
  }

  const pct = {}
  for (const metric of METRICS) {
    const { covered, total } = totals[metric]
    pct[metric] = total > 0 ? round2((covered / total) * 100) : 0
  }
  return { pct, count: targets.length }
}

const rows = []
const failures = []

for (const [name, floor] of Object.entries(modules)) {
  const prefix = name === 'all' ? '' : name
  const { pct, count } = aggregate(prefix)

  // 基线里配了模块但报告里没有任何文件，说明路径写错或基线过期，直接判失败
  if (count === 0) {
    failures.push(`${name}：覆盖率报告里找不到该模块的文件，请检查基线里的路径前缀`)
    continue
  }

  const low = METRICS.filter((metric) => pct[metric] < (floor[metric] ?? 0))
  for (const metric of low) {
    failures.push(
      `${name} ${LABELS[metric]} ${pct[metric]}% 低于基线 ${floor[metric]}%（差 ${round2(floor[metric] - pct[metric])}）`
    )
  }
  rows.push({ name, pct, floor, ok: low.length === 0 })
}

const pad = (text, width) => String(text).padEnd(width)
console.log('\n覆盖率基线校验（阈值定义见 scripts/coverage-baseline.json）')
console.log(`${pad('模块', 28)}${pad('语句', 10)}${pad('分支', 10)}${pad('函数', 10)}${pad('行', 10)}判定`)
for (const { name, pct, floor, ok } of rows) {
  const cell = (metric) => pad(`${pct[metric]}`, 10)
  console.log(
    `${pad(name, 28)}${cell('statements')}${cell('branches')}${cell('functions')}${cell('lines')}${
      ok ? 'OK' : '低于基线'
    }`
  )
}

if (failures.length > 0) {
  console.error('\n!! 覆盖率低于基线，已阻止本次操作：')
  for (const line of failures) console.error(`   - ${line}`)
  console.error('\n   请补充测试覆盖。不得以下调基线、调整阈值或缩小统计范围的方式让检查通过。')
  process.exit(1)
}

console.log('\n覆盖率基线通过')
