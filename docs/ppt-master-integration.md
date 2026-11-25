# PPT Master 集成

Claude360 Copilot 通过 [PPT Master](https://github.com/hugohe3/ppt-master) skill 生成原生可编辑的 PPTX。本文说明它如何被分发、安装与驱动。

## 形态

PPT Master 是一个 **Claude Code Skill**，不是库也不是服务：`SKILL.md` 做路由，`workflows/` 是四条主路线，`references/` 是角色定义，`scripts/` 下约 90 个 Python 脚本干实际的活。技术路线是「Agent 手写 SVG 页面 → Python 转成原生 DrawingML」。

因此集成的方式是**装配**：kun 运行时本来就有完整的 skill 系统（发现、注入、`load_skill`），我们负责把 skill 放到它能看见的地方，并备好 Python 环境。

> **不要修改 skill 目录内的任何文件。** 它的 `SKILL.md` 强制第二步执行 `scripts/attribution_guard.py`，校验 LICENSE(sha256)、SPONSORS、13 个 gate 脚本与 frontmatter 固定值，失败即停且明令禁止绕过。上游是 MIT，再分发保留版权声明即可。

## 组件

| 位置 | 职责 |
| --- | --- |
| `src/shared/ppt-master.ts` | 共享契约：包名、版本、状态类型、环境变量名 |
| `src/main/services/ppt-master-installer.ts` | 解析 skill 来源（覆盖 / 内置 / 下载）；下载分支负责校验 sha512、解压到 userData、跑完整性自检 |
| `src/main/services/ppt-master-python-env.ts` | 建 venv、装 requirements、探测模块、拼 PATH |
| `src/main/services/ppt-master-service.ts` | 门面：把 skill 与 Python 合成一个「能不能用」的状态 |
| `src/main/services/ppt-master-provision.ts` | 启动后台预装的调度与空闲重启判断 |
| `src/renderer/.../personas/ppt-master.ts` | PPT 助手 persona（引导模型 `load_skill` 并让路） |
| `src/renderer/.../PptMasterEnvPanel.tsx` | 助手详情里的环境面板 |

## skill 从哪里来

三条通道，**按顺序取第一个命中**（`pptMasterSkillState`）：

| 顺序 | 通道 | 位置 | 用途 |
| --- | --- | --- | --- |
| 1 | 开发覆盖 | `PPT_MASTER_SKILL_DIR` | 指向一份 checkout，开发/验证用 |
| 2 | **应用内置** | 打包后 `<resources>/ppt-master-skill/`；仓库内 `packages/ppt-master-skill/` | **常规路径**，离线可用、首次启动即可用 |
| 3 | npm 下载 | `<userData>/ppt-master/versions/<version>/` | 故意不内置 payload 的构建才会走到 |

内置优先于下载：它是这个应用版本实际验证过的那一份。

> **内置 payload 不在 git 里**（12917 个文件）。构建前必须先铺好，否则 electron-builder 会警告并打出一个没有 PPT 能力的包：
> ```bash
> node scripts/prepare-ppt-master-package.mjs --from /path/to/ppt-master
> ```
> release CI 建议设 `CLAUDE360_REQUIRE_PPT_MASTER=1`，把警告升级为硬失败。

## 磁盘布局

```
<resources>/ppt-master-skill/ppt-master/   内置 skill 包（extraResources，不进 asar）

<userData>/ppt-master/
  venv/                               托管的 Python 环境（始终在这里）
  installed.json                      仅下载通道：安装清单（版本、包名、integrity）
  versions/<version>/                 仅下载通道：传给 kun 的 skill 扫描根
  downloads/                          仅下载通道：下载中转
```

kun 的 skill 发现会扫描一个根下的直接子目录找 `SKILL.md`，所以扫描根始终是**包含 `ppt-master/` 的那一层**，不是包本身。内置的 skill 必须留在 asar 之外——它的 `SKILL.md` 要 shell 出去跑 `scripts/*.py`，压进归档就跑不了。

## 生效链路

两处都在 **kun 子进程 spawn 时**读取，所以安装后必须重启运行时：

- **skill 根**：`skill-service.ts` 的 `guiSkillRootsForRuntime(settings, workspace, userDataDir)` 追加托管根 → 写进 kun 的 `config.json`
- **Python**：`kun-process.ts` 的 `childEnv` 里用 `withPptMasterPython()` 把 venv 的 bin 前置进 `PATH`，于是 agent 在 bash 工具里跑的 `python3` 命中 venv，**无需改动 kun 的工具层**

后台预装完成后会等运行时空闲（`waitForRuntimeTurnsIdle`）再重启；用户连续工作超过 10 分钟就不打断，留到下次启动生效。

## 安装时机

skill 已内置，所以启动后的后台预装实际上**只做 Python 那一半**：默认在应用启动约 20 秒后静默建 venv、装 requirements（已就绪则秒退）。失败只记日志，助手面板会显示状态并提供重试。

用户也可以从两个入口手动触发，二者调用同一套 IPC：
- 助手画廊 →「PPT 制作助手」→ 详情弹窗底部的环境面板
- 插件市场 → PPT Master 卡片

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PPT_MASTER_SKILL_DIR` | 指向本地 skill 目录，优先级最高，压过内置副本 |
| `PPT_MASTER_BUNDLED_DIR` | 覆盖内置副本的查找位置；设成不存在的路径可强制走下载通道（测试用） |
| `PPT_MASTER_SKILL_PACKAGE` | 覆盖 npm 包名（私有镜像或 fork） |
| `PPT_MASTER_AUTO_INSTALL` | 设为 `0` / `false` 关闭启动预装 |

本地开发示例：

```bash
PPT_MASTER_SKILL_DIR=~/Downloads/ppt-master-main/skills npm run dev
```

该目录下有 `ppt-master/SKILL.md`，会被识别为 skill 包；父目录作为扫描根。铺过 `packages/ppt-master-skill/` 之后其实不需要这个变量，`npm run dev` 会直接用仓库里的内置副本。

## 发布 npm 包（可选的下载通道）

只有在打算发一个不含 payload 的瘦身安装包时才需要。payload 约 79MB / 12917 个文件，不入 git，从上游 checkout 暂存：

```bash
node scripts/prepare-ppt-master-package.mjs --from /path/to/ppt-master
cd packages/ppt-master-skill
npm pack          # 先确认体积与文件数
npm publish
```

脚本会校验版本一致性（`SKILL.md` 的 metadata.version、`package.json`、`src/shared/ppt-master.ts` 的 `PPT_MASTER_VERSION` 三处），并对暂存副本跑一次 attribution guard——那里过不了，用户第一次激活也会以同样方式失败。

升级 skill 版本时三处要一起改。

## 沙箱要求

PPT Master 全程需要执行 Python 脚本，而 `kun/src/adapters/tool/sandbox-policy.ts` 只在 `danger-full-access` 下放行 `command_execution`。此外 skill 装在工作区之外，非 full-access 模式下 `resolveWorkspacePath` 也会拒绝越界读取，连 `references/*.md` 都读不到。

因此实际使用需要把沙箱模式设为「完全访问」。这是线程级设置，应用不会自动提权，环境面板里给出提示由用户自己决定。
