# Peak Player

一个离线优先的桌面音频播放器，基于 Electron + Vue 3 构建。无需联网即可使用，同时预留了对象存储（COS/OSS/S3）扩展能力。

## 功能特性

- **本地播放**：本地音频文件播放，完全离线可用；通过音源抽象层预留对象存储扩展
- **变速播放**：支持 0.8x ~ 1.5x 倍速，`preservesPitch` 保证变速不变调
- **单曲循环 + 计数**：单曲循环模式播放完成自动计数 +1，次数支持手动修改
- **歌词**：自动读取歌曲同目录同名 `.lrc`，全屏「正在播放」页居中滚动、当前行扫光、点击跳转
- **排行榜**：按播放次数 / 收听时长排序
- **用时统计**：近一周每日用时柱形图（ECharts）
- **后台播放**：关闭窗口后进程驻留系统托盘，音频持续播放，禁用后台 CPU 节流

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面框架 | Electron 31 |
| 前端 | Vue 3 + TypeScript + Pinia |
| 构建 | electron-vite + electron-builder |
| 音频 | HTML5 Audio（`playbackRate` + `preservesPitch`） |
| 数据库 | better-sqlite3 |
| 图表 | ECharts |

## 目录结构

```
peak-player/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tsconfig*.json
├── resources/            # 应用/托盘图标
└── src/
    ├── shared/           # 主进程与渲染进程共享类型
    ├── main/             # 主进程
    │   ├── index.ts      # 入口：后台驻留
    │   ├── window.ts     # 窗口：关闭隐藏、禁后台节流
    │   ├── tray.ts       # 系统托盘
    │   ├── protocol.ts   # media:// 自定义协议
    │   ├── db.ts         # SQLite 封装
    │   ├── lyrics.ts     # 同名 .lrc 探测、编码兜底、缓存
    │   ├── ipc.ts        # IPC 通道
    │   └── source.ts     # 音源抽象层（对象存储扩展点）
    ├── preload/          # contextBridge 安全桥接
    └── renderer/         # Vue 3 界面
        ├── core/             # 播放引擎（player）+ 纯函数（时间轴换算/播放决策）
        ├── composables/      # 可单测的组件逻辑（歌词播放头/跟随滚动/进度拖动）
        ├── stores/           # Pinia 状态
        ├── utils/            # 展示格式化、图表整形、歌词定位（纯函数）
        ├── views/            # 资料库 / 影子跟读 / 排行榜 / 用时统计
        └── components/       # 播放控制条 / 歌词面板 / 全屏正在播放
```

## 环境要求

- Node.js >= 18（推荐 20）
- **C++ 编译器支持 C++20**（`g++` >= 10 或 `clang++` >= 11），用于编译 `better-sqlite3`
- Python 3（node-gyp 依赖）

## 快速开始

```bash
# 安装依赖（会编译 better-sqlite3，首次较慢）
npm install

# 下载随包 ffmpeg（约 80MB）
# 变速预渲染、以及 transcode / 时长探测相关的单测都依赖它；
# 缺了这步单测会跳过那组用例，覆盖率随之下降并卡住 pre-commit
npm run fetch:ffmpeg

# 启动开发模式
npm run dev
```

## 构建打包

```bash
# 类型检查
npm run typecheck

# 构建（产出到 out/）
npm run build

# 打包安装包（末尾自动执行打包冒烟，见下）
npm run package:win     # Windows (nsis)
npm run package:mac     # macOS (dmg)
npm run package:linux   # Linux (AppImage)
```

### 打包冒烟

`ffmpeg` 二进制不进仓库，由 `scripts/fetch-ffmpeg.mjs` 在打包前下载，再由
`extraResources` 拷进包内 `resources/bin/`。这一步一旦被跳过（直接调 `electron-builder`）、
平台参数写错（macOS 包塞了 win32 二进制）或配置被改动，`electron-builder`
通常只 warn 一句照样出包，用户装完才发现变速不可用。

```bash
# 单独校验已有产物（release/ 下必须已有 *-unpacked 目录）
npm run check:package
```

校验内容：包内 `resources/bin/ffmpeg(.exe)` 存在、体积 > 1MB、宿主平台下能执行 `-version`、
`-filters` 含 `rubberband`。`package:win|mac|linux` 末尾自动执行，CI 也会在打包后单独跑一次。

## 单元测试

使用 Vitest 编写单元测试，覆盖核心业务逻辑。原则是「先抽纯函数再测」：能脱离 DOM 的
计算与交互逻辑放在 `utils/`、`core/`、`composables/`，组件层只做绑定。少量组件测试用
`happy-dom` 环境（文件头 `// @vitest-environment happy-dom`）挂载真实 `.vue`，验证事件接线。

**主进程**

- `src/main/db.test.ts` — 数据库操作（增删改查、计数、用时、排行、周统计）
- `src/main/source.test.ts` — 音源抽象层
- `src/main/range.test.ts` — Range 请求解析与 200/206/416 响应头
- `src/main/media-request.test.ts` — `media://` 请求解析与状态码决策
- `src/main/ffmpeg-args.test.ts` — rubberband 滤镜串、`-i` 探测输出与 `-progress` 解析
- `src/main/ffmpeg-path.test.ts` — ffmpeg 可执行文件路径回退
- `src/main/transcode-pure.test.ts` — 转码参数拼装、产物判定、错误与日志文案
- `src/main/variant-cache.test.ts` — 变速缓存命名与清理策略
- `src/main/track-duration.test.ts` — 时长采集结果的取整与校验
- `src/main/lyrics.test.ts` — 同名 `.lrc` 路径探测、UTF-8/GBK/UTF-16 解码、体积上限与缓存失效
- `src/main/audio-exts.test.ts` — 可导入音频扩展名白名单
- `src/main/ipc-contract.test.ts` — IPC 通道契约

**渲染进程**

- `src/renderer/src/core/time-mapping.test.ts` — 变速播放的时间轴换算
- `src/renderer/src/core/playback.test.ts` — 倍速钳制、降级判断、进度采纳、计时结算、循环动作
- `src/renderer/src/utils/format.test.ts` — 时间/时长/倍速/进度展示与次数输入解析
- `src/renderer/src/utils/chart.test.ts` — 用时统计图的数据整形与 option 构造
- `src/renderer/src/utils/lyrics.test.ts` — 当前歌词行二分定位、行内进度、居中滚动位置
- `src/renderer/src/composables/useLyricsPlayhead.test.ts` — 歌词 rAF 采样：播放/暂停/换源期跳过、启停幂等
- `src/renderer/src/composables/useLyricFollow.test.ts` — 歌词自动跟随：居中滚动、手动浏览挂起、恢复与清理
- `src/renderer/src/composables/useSeekDrag.test.ts` — 进度条拖动状态：拖动值、非法值收敛、松手才 seek
- `src/renderer/src/stores/library.test.ts` — 资料库 store（曲目与播放列表）
- `src/renderer/src/stores/lyrics.test.ts` — 歌词 store：切歌清空、过期结果丢弃、IPC 失败降级
- `src/renderer/src/stores/stats.test.ts` — 统计 store

**组件**（`// @vitest-environment happy-dom`，真实挂载）

- `src/renderer/src/components/LyricsPanel.test.ts` — 空态、当前行/已唱行标记、点击跳转、手动滚动挂起与回位、换歌复位
- `src/renderer/src/components/NowPlayingView.test.ts` — 开关渲染、Esc 关闭、进度拖动、倍速切换、循环切换、预渲染/错误提示

**共享**

- `src/shared/track-url.test.ts` — 音源 URL 解析
- `src/shared/lyrics.test.ts` — LRC 解析：时间戳格式、一行多时间戳、offset、双语合并与去重

**集成测试**（`test/integration/`，跨模块 + 真实外部资源）

- `media-protocol.test.ts` — 真实文件经 `media://` 的 200/206/416/404/400、字节偏移、特殊字符路径
- `ipc-handlers.test.ts` — handler 集合与 preload 通道对齐、导入过滤、进度回传、sender 销毁保护
- `db-usage-chain.test.ts` — 真实 SQLite 文件 + `tracks:update` → 补采时长 → 联动用时统计
- `transcode.test.ts` — 真实 ffmpeg + rubberband：产物可解码、缓存命中、半成品清理（无 ffmpeg 时跳过）
- `player-engine.test.ts` — 假 Audio 驱动的播放状态机：预渲染/降级、时间轴换算、循环计数、计时结算
- `package-smoke.test.ts` — 打包配置（`extraResources` / asar 排除）与产物冒烟脚本的判定逻辑

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch

# 覆盖率报告（coverage/）
npm run test:coverage

# 只校验基线（需先有 coverage/coverage-summary.json）
npm run check:coverage
```

> 说明：better-sqlite3 以 electron ABI 编译，测试通过 `scripts/run-tests.mjs`
> 以 `ELECTRON_RUN_AS_NODE=1` 方式运行，确保原生模块 ABI 与运行时一致。
>
> 本机 glibc < 2.29 时该原生模块加载不了，`db.test.ts` 会整片标红（并非代码问题），
> 处理方式见下方常见问题「GLIBC_2.29 not found」。

### 覆盖率基线

`scripts/coverage-baseline.json` 记录各模块的下限（覆盖率为 0 的模块不设基线）：

| 模块 | 语句 | 分支 | 函数 | 行 |
|---|---|---|---|---|
| all | 65.23 | 90.31 | 83.03 | 65.23 |
| `src/main/` | 76.81 | 90.64 | 83.06 | 76.81 |
| `src/shared/` | 98 | 98 | 98 | 98 |
| `src/renderer/src/core/` | 93.71 | 90.97 | 92.29 | 93.71 |
| `src/renderer/src/stores/` | 98 | 98 | 98 | 98 |
| `src/renderer/src/utils/` | 98 | 98 | 98 | 98 |

> `transcode.test.ts` 与时长探测需要带 rubberband 的 ffmpeg，否则整组跳过、`src/main/`
> 会掉约 6 个百分点。CI 因此在单测之前就执行 `node scripts/fetch-ffmpeg.mjs`
> （缓存命中时只做可用性校验），保证本机与 CI 用的是同一份二进制、覆盖率口径一致。

`pre-commit`、`pre-push` 与 CI（`.github/workflows/ci.yml`）都执行
`npm run test:coverage` + `npm run check:coverage`，任一模块的任一指标低于基线时，
提交、推送和 CI 构建都会被中断。

覆盖率不足时的正确做法是补充测试。不得以下调基线、调整阈值或缩小统计范围的方式让检查通过；
基线文件属于受审配置，确需变更时必须单独提交，并附完整测量数据与评审结论，不能与功能改动混合提交。

> 说明：歌词面板、全屏播放页已用 `happy-dom` 做挂载测试，纯逻辑则下沉到
> `utils/`、`core/`、`composables/`。入口文件与其余展示组件仍无组件级测试，
> 但 `all` 是实际门槛，不会因为模块级数字达标而豁免。

## 端到端测试

用 Playwright 驱动**真实 Electron 进程**（主进程 + 渲染进程 + `media://` + SQLite + ffmpeg），
覆盖单元/集成测试触达不到的链路：窗口生命周期、托盘通道、重启持久化、单实例、真实音频解码。

```bash
# E2E 只驱动 Electron 自带的 Chromium，不需要 Playwright 下载浏览器
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# 构建 + 跑 E2E
npm run test:e2e

# 复用已有 out/ 直接跑
npx playwright test
```

- 每个用例独占临时 `userData` 与音频素材（运行时生成 WAV，不入库），互不污染
- `dialog.showOpenDialog` 在主进程内被替换，无需人工选文件
- 无 ffmpeg 时变速用例自动降级断言（不报错、仍可播）；有 ffmpeg 时走真实预渲染
- Linux 无桌面环境需 `xvfb-run -a npm run test:e2e`；Windows/macOS 直接运行
- 失败产物在 `test-results/`、`playwright-report/`（已 gitignore），可用 `npx playwright show-trace` 回放

## 架构说明

### 进程模型

- **主进程**：窗口管理、系统托盘、文件系统、SQLite 数据库、IPC
- **渲染进程**：Vue 3 界面 + 播放引擎
- **Preload**：通过 `contextBridge` 暴露安全的 `window.api`

### 本地音频访问

渲染进程（开发态为 `http://localhost`）无法直接通过 `file://` 访问本地文件，因此注册了自定义 `media://` 协议：

```
media://play?path=<encodeURIComponent(绝对路径)>
```

主进程通过 `protocol.handle` 将请求映射到本地文件。

### 歌词

只读取歌曲同目录同名 `.lrc` 文件（`/music/歌名.mp3` → `/music/歌名.lrc`），完全离线、无新依赖：

- 支持 `[mm:ss]` / `[mm:ss.xx]`、一行多时间戳、`[offset:±ms]`、同时间戳双语合并
- 编码自动识别：UTF-8（含 BOM）、UTF-16 LE/BE、GBK
- 点击播放条标题或「歌词」按钮打开全屏「正在播放」：当前行居中高亮、按行内进度扫光、点击任意行跳转，`Esc` 收起
- 歌词时间轴与原速时间一致，变速播放由引擎换算，无需调整歌词

### 后台播放

1. 拦截窗口 `close` 事件，改为 `hide()`（而非销毁）
2. 创建系统托盘，提供「播放/暂停」「显示主界面」「退出」
3. `webContents.setBackgroundThrottling(false)` 禁用后台节流

### 循环计数实现

`audio.loop = true` 时不会触发 `ended` 事件，因此采用手动循环：

```ts
audio.addEventListener('ended', () => {
  incrementCount(id, 1)       // 完成 +1
  if (loopMode === 'single') {
    audio.currentTime = 0
    audio.play()
  }
})
```

## 数据库设计

数据库文件位于 `app.getPath('userData')/peak-player.db`。

```sql
-- 歌曲表
CREATE TABLE tracks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  path          TEXT NOT NULL,          -- 本地绝对路径 或 远程对象键
  source_type   TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'remote'
  play_count    INTEGER NOT NULL DEFAULT 0,     -- 播放次数（可手动改）
  total_seconds INTEGER NOT NULL DEFAULT 0,     -- 累计收听时长
  duration      INTEGER NOT NULL DEFAULT 0      -- 曲目真实时长（播放时采集，改次数时换算用时）
);

-- 每日用时表
CREATE TABLE daily_usage (
  date    TEXT PRIMARY KEY,  -- 'YYYY-MM-DD'
  seconds INTEGER NOT NULL DEFAULT 0
);
```

> 入库按 `path` 去重：同一文件重复导入不会新增行（每次导入都会生成新的 `id`，
> 只靠主键挡不住）。判定在 `addTracks` 的事务内完成，因此同一次导入里重复选中的文件
> 也只会入库一次。老库里此前产生的重复行不会被自动清理。

## 扩展指南：接入对象存储

音源统一通过 `src/main/source.ts` 的 `TrackSource` 接口抽象：

```ts
export interface TrackSource {
  sourceType: 'local' | 'remote'
  resolvePlayableUrl(): Promise<string>
}
```

接入 COS / OSS / S3 时，只需实现 `RemoteSource`（下载到本地临时目录后返回 `media://` 地址，或返回签名 URL），播放、计数、统计逻辑零改动。

## 常见问题

### better-sqlite3 编译失败：`g++: unrecognized command line option '-std=c++20'`

系统编译器版本过旧。安装新版 GCC（以 Rocky/CentOS 8 的 gcc-toolset-12 为例）：

```bash
dnf install -y gcc-toolset-12
source /opt/rh/gcc-toolset-12/enable
export CC=$(which gcc) CXX=$(which g++)
npm install
```

### better-sqlite3 加载报错：`GLIBC_2.29 not found`

`better-sqlite3` 的 prebuilt 二进制在较新 glibc 上编译，本机 glibc 过旧（如 2.28）。需强制从源码编译：

```bash
cd node_modules/better-sqlite3
node <npm-node-gyp路径> rebuild --release \
  --target=<electron版本> --arch=x64 \
  --dist-url=https://electronjs.org/headers/
```

重编译不可行时，`db.test.ts` 会在该机器上整片失败，这与代码无关：把单元测试交给 CI
（`.github/workflows/ci.yml`，跑在 windows-latest）或另一台 glibc 达标的机器验证即可。

### electron 启动报缺少共享库（如 `libnss3.so`）

安装 electron 运行时依赖：

```bash
dnf install -y alsa-lib atk at-spi2-atk at-spi2-core cairo cups-libs \
  libdrm mesa-libgbm gdk-pixbuf2 gtk3 nspr nss nss-util pango \
  libX11 libxcb libXcomposite libXdamage libXext libXfixes libXrandr
```
