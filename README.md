<p align="center">
  <img src="src/asset/img/claude360.png" width="104" alt="Claude360 Copilot 图标">
</p>

<h1 align="center">Claude360 Copilot</h1>

<p align="center">
  <strong>一个账号，四大工作台：编程 · 写作 · 生图 · 音乐。</strong><br>
  接入 Claude360 中转站，把 AI Agent 放进真实工作流，而不只是一个聊天框。
</p>

<p align="center">
  <a href="./README.en.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
  &nbsp;·&nbsp;
  <a href="https://github.com/Johnhpure/claude360-Copilot/releases">下载</a>
  &nbsp;·&nbsp;
  <a href="#核心工作台">功能</a>
  &nbsp;·&nbsp;
  <a href="#从源码运行">源码运行</a>
</p>

<p align="center">
  <a href="https://github.com/Johnhpure/claude360-Copilot/releases"><img src="https://img.shields.io/github/v/release/Johnhpure/claude360-Copilot?label=release" alt="GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="License: PolyForm Noncommercial 1.0.0"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white" alt="Electron 34">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
</p>

**Claude360 Copilot** 是一个跨平台桌面 AI 工作台。你用一个 Claude360 账号登录，就能在同一个应用里完成 **编程、写作、生图、音乐** 四类创作——而不用在多个网页、多个订阅、多套 API Key 之间来回切换。

它区别于"只会聊天"的客户端：Code 工作台可以绑定本地代码库，读写文件、执行命令、审查每一次变更；写作工作台是一个完整的 Markdown 创作环境；生图与音乐工作台把文生图 / 图生图、Suno 音乐创作直接做进桌面端。所有模型请求统一通过 **Claude360 中转站**（兼容 OpenAI 风格接口）转发，账号、分组、倍率与 Key 都在应用内一站式管理。

会话、日志、偏好设置和运行时数据默认保存在本机；API Key 仅在主进程加密存储，不落明文。对会读写文件、执行命令的高权限流程，应用提供工具审批、权限模式、内联 diff 和变更审查面板。

---

<p align="center">
  <a href="src/asset/img/code.mp4">
    <img src="src/asset/img/code.gif" width="410" alt="Code 工作台演示">
  </a>
  <a href="src/asset/img/write.mp4">
    <img src="src/asset/img/write.gif" width="410" alt="写作工作台演示">
  </a>
</p>

## 核心工作台

Claude360 Copilot 把四类高频创作场景收敛成四个工作台，共享同一套账号、分组与本地运行时。

### 🧩 Code —— 需求驱动的 Agent 编程

不是"给一句话就直接改代码"，而是把 **需求 → 设计 → 计划 → 编码 → 验收** 串成一条连续的 GUI 工作流。

- 绑定本地项目目录，读取代码上下文、执行 shell 命令、修改文件。
- 需求草稿与 AI 澄清、实现前调研、结构化需求块与验收标准。
- `/plan` 生成可管理的实施计划，进入 Todo、`/goal`、旁支对话、会话压缩、分叉与归档。
- 提交前的内联 diff、变更审查面板、`/review` 与工具审批、文件系统权限模式。
- 接入 MCP（Model Context Protocol）服务器与项目 / 全局 Skills，按任务扩展工具能力。

### ✍️ 写作 —— 独立的 Markdown 创作环境

一个与 Code 解耦的写作工作区，让长文创作也有 Agent 加持。

- Markdown 文件树 + Live / Source / Split / Preview 多种预览模式切换。
- AI 行内补全、选区改写润色、图片附件。
- 一键导出 `HTML / PDF / DOC / DOCX`。

### 🎨 生图 —— 文生图 / 图生图工作台

从提示词到成图的完整参数面板，覆盖主流出图需求。

| 参数 | 可选值 |
| --- | --- |
| 模型 | 由所选分组下的可用生图模型决定 |
| 参考图（可选） | 上传后走图生图，不传即文生图 |
| 宽高比 | 10 档预设（方形 / 宽屏 / 竖屏 / 打印 / 信息流等）图标网格 |
| 分辨率 | 1K / 2K / 4K |
| 张数 | 单次批量生成 |
| 质量 | 自动 / 高 / 中 / 低 |
| 输出格式 | PNG / JPEG / WebP |

配套历史面板与结果网格，便于回看与对比。

### 🎵 音乐 —— Suno 音乐创作工作台

两种创作模式，从灵感到成曲。

- **一句话生成**：仅需模型 + 一句话描述，快速出曲。
- **标准模式**：标题 + 歌词（内置 **✨ AI 写词助手**，流式逐字生成、采用即填入）+ 曲风预设 chips + 反向曲风标签 + 纯器乐开关 + 高级参数（人声性别 / 曲风权重 / 创意度 / persona）。
- 作品列表回传封面，内置增强播放器：进度拖动、音量调节、上一首 / 下一首队列播放。

## 账号、分组与 Key

Claude360 Copilot 取消了传统"逐个填 Provider / 手抄 API Key"的心智，改为围绕 **账号 → 分组 → 模型** 组织。

- **应用内登录**：支持网页授权登录与账号密码 + 2FA 两种方式，无需手动粘贴 Key。
- **分组及 Key**：在设置中查看账号可用分组（含倍率）、每个分组下的模型，并按分组管理 API Key。
- **按需自动建 Key**：在任一工作台选择模型时，应用会自动检测该分组是否已有可用 Key——没有则弹出优雅模态，确认后自动创建并回填，全程无需离开应用。
- **安全存储**：API Key 仅在主进程通过加密存储保存，渲染进程与配置文件中不出现明文。

## 为什么选择 Claude360 Copilot

| 你想要 | Claude360 Copilot 提供 |
| --- | --- |
| 一个入口搞定多类创作 | 编程 / 写作 / 生图 / 音乐四大工作台，共享同一账号与运行时 |
| 一份账号、一处计费 | 通过 Claude360 中转站统一转发，分组、倍率、Key 应用内管理 |
| 让 AI 面向真实项目工作 | 绑定本地工作区，读写文件、搜索代码、执行命令、审查变更 |
| 把需求推进到可执行计划 | 需求草稿、`/plan`、Todo、`/goal`、会话压缩、分叉与归档 |
| 让改动保持可控 | 工具审批、权限模式、内联 diff、变更审查面板与 `/review` |
| 在同一个应用里写作 | Markdown 文件树、多预览模式、AI 补全 / 改写、多格式导出 |
| 直接做出图与音乐 | 文生图 / 图生图参数面板、Suno 一句话 / 标准创作与 AI 写词 |
| 数据与密钥留在本机 | 会话 / 日志 / 配置本地保存，Key 主进程加密、不落明文 |

## 更多演示

<p align="center">
  <a href="src/asset/img/pdf-research.mp4">
    <img src="src/asset/img/pdf-research.gif" width="680" alt="PDF 研究演示">
  </a>
</p>
<p align="center"><em>PDF 研究与资料整理</em></p>

<p align="center">
  <a href="src/asset/img/sdd.mp4">
    <img src="src/asset/img/sdd.gif" width="680" alt="需求澄清、需求文档与计划演示">
  </a>
</p>
<p align="center"><em>需求澄清、需求文档与实施计划</em></p>

## 快速开始

### 路径 A：下载发布版

前往 [GitHub Releases](https://github.com/Johnhpure/claude360-Copilot/releases) 下载最新版本。

| 平台 | 安装包 | 架构 |
| --- | --- | --- |
| Windows | `.zip` 便携包（解压即用） | x64 |
| macOS | `.dmg` 或 `.zip` | Intel / Apple Silicon |
| Linux | `.AppImage` | x64 |

> macOS 无签名版本首次打开需在「系统设置 → 隐私与安全性」点「仍要打开」，或右键 →「打开」。

### 首次启动

1. 选择界面语言（默认 **简体中文**）。
2. 登录 Claude360 账号：网页授权，或账号密码 + 2FA。
3. 进入任一工作台开始创作——在 Code 绑定本地项目，或在写作 / 生图 / 音乐工作台直接开工。
4. 选择模型时若对应分组尚无 Key，按提示确认自动创建即可。

### <a id="从源码运行"></a>路径 B：从源码运行

环境要求：

| 依赖 | 版本 |
| --- | --- |
| Node.js | 20+ |
| npm | 随 Node.js 安装 |
| Claude360 账号 | 用于登录并获取分组 / 模型 / Key |

```bash
git clone https://github.com/Johnhpure/claude360-Copilot.git
cd claude360-Copilot
npm install
npm run dev
```

中国大陆访问较慢时，可使用 npm 镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建本地运行时并启动 Electron 开发环境 |
| `npm run build` | 生产构建 |
| `npm run typecheck` | TypeScript 类型检查（web + node 双 tsconfig） |
| `npm run lint` | ESLint 检查 |
| `npm run test` | 运行 Vitest 测试 |
| `npm run dist:win` | 本地构建 Windows 便携包（需在 Windows 上） |
| `npm run dist:mac` | 本地构建 macOS `.dmg` 和 `.zip`（需在 macOS 上） |
| `npm run dist:linux` | 本地构建 Linux AppImage |

## 打包与发布

原生模块（`node-pty` 等）无法跨平台交叉编译，**Windows 与 macOS 安装包必须在对应平台或 CI 上构建**。仓库已配好 GitHub Actions 工作流 `.github/workflows/build-installers.yml`：

- 打 `v*` 标签（如 `v0.2.0`）：云端产出 **三平台** 安装包。
- 打 `win-v*` 标签（如 `win-v0.1.3`）：**仅打 Windows x64** 便携包，用于快速出测试包。
- 也可在 GitHub → Actions → Build Installers → Run workflow 手动触发（可勾选 `only_windows`）。

构建产物在对应 run 页面底部 **Artifacts** 下载（`Claude360-Copilot-Windows-x64` / `Claude360-Copilot-macOS`，保留 14 天）。完整说明见 [打包指引](doc/BUILD-打包环境与安装包.md)。

## 配置与数据

- 偏好设置、会话、日志与本地运行时数据默认保存在本机。
- 模型请求统一经 Claude360 中转站转发；分组、倍率、模型列表随账号拉取。
- API Key 仅在主进程加密存储，渲染进程与配置文件中不出现明文。
- 四大工作台共用同一本地运行时边界（HTTP/SSE），便于复用会话、审批、工具与用量统计。
- 文件读写、命令执行、MCP 工具等高权限能力均经过权限与审批控制。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Electron 34 |
| 前端 | React 19 + TypeScript + Tailwind CSS |
| 构建 | electron-vite（Vite 6） |
| 状态管理 | Zustand |
| 测试 | Vitest |
| 运行时边界 | 内置本地运行时，提供 HTTP/SSE，采用 cache-first agent loop、追加式事件日志与上下文压缩 |
| 中转接入 | Claude360 中转站（OpenAI 兼容风格接口） |

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [doc/BUILD-打包环境与安装包.md](doc/BUILD-打包环境与安装包.md) | 打包能力矩阵、GitHub Actions 云端打包与本地打包 |
| [docs/DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) | 本地开发流程、分支策略与发布说明 |
| [docs/CONTRIBUTING.zh-CN.md](docs/CONTRIBUTING.zh-CN.md) | 贡献说明 |
| [SECURITY.zh-CN.md](SECURITY.zh-CN.md) | 安全漏洞披露方式 |

## 贡献

欢迎提交 bug 修复、UI/UX 优化、文档改进、本地化内容与构建发布流程相关改动。

- 发起 PR 前建议运行 `npm run typecheck`、`npm run lint`、`npm run test` 与 `npm run build`。
- 外部贡献需接受 [Contributor License Agreement](./CLA.md)。

## 许可证

本项目仅供学习和参考，**不可用于任何商业用途**。商业使用、商业分发、SaaS / 托管服务、二次销售或集成到商业产品中，均需获得作者单独书面授权。

教育机构与公益教育机构可用于非商业教学、研究、课程实验和学习参考。完整条款见 [PolyForm Noncommercial License 1.0.0](./LICENSE)。

## 致谢

Claude360 Copilot 基于优秀的开源 Electron Agent 客户端二次开发，并深度整合 Claude360 中转站的模型能力。感谢上游开源社区，以及所有提交 issue、建议、代码和文档的贡献者。
