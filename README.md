# Peak Player

一个离线优先的桌面音频播放器，基于 Electron + Vue 3 构建。无需联网即可使用，同时预留了对象存储（COS/OSS/S3）扩展能力。

## 功能特性

- **本地播放**：本地音频文件播放，完全离线可用；通过音源抽象层预留对象存储扩展
- **变速播放**：支持 0.8x ~ 1.5x 倍速，`preservesPitch` 保证变速不变调
- **单曲循环 + 计数**：单曲循环模式播放完成自动计数 +1，次数支持手动修改
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
    │   ├── ipc.ts        # IPC 通道
    │   └── source.ts     # 音源抽象层（对象存储扩展点）
    ├── preload/          # contextBridge 安全桥接
    └── renderer/         # Vue 3 界面
        ├── core/             # 播放引擎（player）+ 纯函数（时间轴换算/播放决策）
        ├── stores/           # Pinia 状态
        ├── utils/            # 展示格式化与图表整形（纯函数）
        ├── views/            # 音乐库 / 排行榜 / 用时统计
        └── components/       # 播放控制条
```

## 环境要求

- Node.js >= 18（推荐 20）
- **C++ 编译器支持 C++20**（`g++` >= 10 或 `clang++` >= 11），用于编译 `better-sqlite3`
- Python 3（node-gyp 依赖）

## 快速开始

```bash
# 安装依赖（会编译 better-sqlite3，首次较慢）
npm install

# 启动开发模式
npm run dev
```

## 构建打包

```bash
# 类型检查
npm run typecheck

# 构建（产出到 out/）
npm run build

# 打包安装包
npm run package:win     # Windows (nsis)
npm run package:mac     # macOS (dmg)
npm run package:linux   # Linux (AppImage)
```

## 单元测试

使用 Vitest 编写单元测试，覆盖核心业务逻辑。原则是「先抽纯函数再测」，避免为测试挂载 Vue 组件。

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
- `src/main/audio-exts.test.ts` — 可导入音频扩展名白名单
- `src/main/ipc-contract.test.ts` — IPC 通道契约

**渲染进程**

- `src/renderer/src/core/time-mapping.test.ts` — 变速播放的时间轴换算
- `src/renderer/src/core/playback.test.ts` — 倍速钳制、降级判断、进度采纳、计时结算、循环动作
- `src/renderer/src/utils/format.test.ts` — 时间/时长/倍速/进度展示与次数输入解析
- `src/renderer/src/utils/chart.test.ts` — 用时统计图的数据整形与 option 构造
- `src/renderer/src/stores/library.test.ts` — 音乐库 store
- `src/renderer/src/stores/stats.test.ts` — 统计 store

**共享**

- `src/shared/track-url.test.ts` — 音源 URL 解析

```bash
# 运行测试
npm test

# 监听模式
npm run test:watch

# 覆盖率报告（coverage/）
npm run test:coverage
```

> 说明：better-sqlite3 以 electron ABI 编译，测试通过 `scripts/run-tests.mjs`
> 以 `ELECTRON_RUN_AS_NODE=1` 方式运行，确保原生模块 ABI 与运行时一致。
>
> 若本机 glibc < 2.29（见下方常见问题），`db.test.ts` 会因原生模块加载失败而整片标红。
> 此时用 `PEAK_SKIP_DB=1 npm test` 跳过数据库用例、验证其余逻辑，数据库用例交给 CI 或远程开发机。

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
  total_seconds INTEGER NOT NULL DEFAULT 0      -- 累计收听时长
);

-- 每日用时表
CREATE TABLE daily_usage (
  date    TEXT PRIMARY KEY,  -- 'YYYY-MM-DD'
  seconds INTEGER NOT NULL DEFAULT 0
);
```

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

### electron 启动报缺少共享库（如 `libnss3.so`）

安装 electron 运行时依赖：

```bash
dnf install -y alsa-lib atk at-spi2-atk at-spi2-core cairo cups-libs \
  libdrm mesa-libgbm gdk-pixbuf2 gtk3 nspr nss nss-util pango \
  libX11 libxcb libXcomposite libXdamage libXext libXfixes libXrandr
```
