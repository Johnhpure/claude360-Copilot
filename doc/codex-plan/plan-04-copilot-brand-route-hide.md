# Copilot Brand Route And Hidden Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划不包含 git 提交步骤；每个任务完成后运行验证，提交仅在用户明确要求后执行。

**Goal:** 将应用身份、打包名称和可见入口改为 Claude360 Copilot，并隐藏第一阶段不交付的插件、手机连接、计划任务、Workflow、小鸟形象相关功能。

**Architecture:** 品牌改造集中在 package/electron-builder/app identity/assets；功能入口采用 feature visibility 层隐藏，不删除底层模块，避免破坏已有 runtime 和测试。路由层新增 `my`、`music`、`canvas` 骨架由各功能计划填充，旧 route 可保留但不从主 UI 暴露。

**Tech Stack:** Electron Builder、Electron main、React、TypeScript、Vitest、lucide-react。

---

## File Structure

- Modify: `claude360-Copilot/package.json`
  - `name`、`productName`、description、author/homepage/repository 后续按 Claude360 修改。
  - dist 脚本清理产物名中的 `Kun` / `DeepSeek-GUI`。

- Modify: `claude360-Copilot/electron-builder.config.cjs`
  - `appId: 'xyz.claude360.copilot'`。
  - `productName: 'Claude360 Copilot'`。
  - `artifactName`、NSIS shortcutName/uninstallDisplayName、mac microphone usage text、Linux icon。

- Modify: `claude360-Copilot/src/main/app-identity.ts`
  - 应用显示名、协议、userData 相关身份。

- Modify: `claude360-Copilot/src/main/app-identity.test.ts`
- Modify: `claude360-Copilot/src/main/packaging-config.test.ts`

- Modify: `claude360-Copilot/src/main/main-paths.ts`
  - 新 userData/default workspace 命名策略如涉及 app name。

- Modify: `claude360-Copilot/src/main/main-paths.test.ts`

- Replace/Create assets:
  - `claude360-Copilot/src/asset/img/claude360.png`
  - `claude360-Copilot/src/asset/img/claude360_mac.png`
  - `claude360-Copilot/build/icon.ico`
  - `claude360-Copilot/build/icon.icns` 或现有构建脚本要求的图标文件

- Modify: `claude360-Copilot/src/main/app-icon.ts`
  - 指向 Claude360 图标。

- Modify: `claude360-Copilot/src/renderer/src/store/chat-store-types.ts`
  - `AppRoute` 增加 `my`、`music`、`canvas`。

- Modify: `claude360-Copilot/src/renderer/src/components/Workbench.tsx`
  - 支持新路由；停止渲染 `IkunCameoLayer`、`KunCelebrationLayer`。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/Sidebar.tsx`
  - 隐藏插件、Claw、Schedule、Workflow 可见入口。
  - 移除 `SidebarMascot` 渲染。
  - 添加 “我的”、“生图”、“音乐”入口。

- Modify: `claude360-Copilot/src/renderer/src/components/chat/WorkspaceModeTabs.tsx`
  - 如该组件负责模式入口，隐藏非第一阶段入口。

- Modify: `claude360-Copilot/src/renderer/src/components/SettingsView.tsx`
  - 隐藏插件市场、手机连接、计划任务、Workflow、形象工坊设置入口。

- Modify tests:
  - `src/renderer/src/components/chat/AnimatedWorkLogo.test.ts`
  - `src/renderer/src/components/chat/__tests__/WorkspaceModeTabs.test.ts`
  - `src/renderer/src/components/chat/Sidebar*.test.ts`
  - `src/renderer/src/components/SettingsView` 相关测试

- Optional Create: `claude360-Copilot/src/renderer/src/lib/feature-visibility.ts`
  - 集中定义第一阶段可见功能。

- Optional Test: `claude360-Copilot/src/renderer/src/lib/feature-visibility.test.ts`

## Visibility Policy

第一阶段可见：

- Chat / Code。
- Write。
- My。
- Canvas。
- Music。
- Settings 中的通用设置、账号相关设置、必要运行时设置。

第一阶段隐藏入口：

- Plugins。
- Claw / 手机连接。
- Schedule。
- Workflow。
- 形象工坊。
- SidebarMascot。
- IkunCameoLayer。
- KunCelebrationLayer。

隐藏不等于删除。旧模块保留，避免后续二期恢复或导致大面积回归。

## Task 1: 品牌基础测试

**Files:**

- Modify: `package.json`
- Modify: `electron-builder.config.cjs`
- Modify: `src/main/app-identity.ts`
- Test: `src/main/app-identity.test.ts`
- Test: `src/main/packaging-config.test.ts`

- [x] **Step 1: 写品牌断言测试**

断言：

- productName 为 `Claude360 Copilot`。
- appId 为 `xyz.claude360.copilot`。
- artifactName 以 `Claude360-Copilot-` 开头。
- NSIS shortcutName/uninstallDisplayName 为 `Claude360 Copilot`。
- macOS 使用说明文案不再出现 Kun。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/app-identity.test.ts src/main/packaging-config.test.ts
```

Expected: FAIL，仍为 Kun 或 DeepSeek GUI。

- [x] **Step 3: 修改品牌配置**

改动：

- `package.json` 的 `name` 建议为 `claude360-copilot`。
- `productName` 为 `Claude360 Copilot`。
- `electron-builder.config.cjs` 的 `appId` 为 `xyz.claude360.copilot`。
- 产物名为 `Claude360-Copilot-${version}-${os}-${arch}.${ext}`。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/app-identity.test.ts src/main/packaging-config.test.ts
```

Expected: PASS。

## Task 2: 新 appId 与数据目录策略

**Files:**

- Modify: `src/main/app-identity.ts`
- Modify: `src/main/main-paths.ts`
- Test: `src/main/app-identity.test.ts`
- Test: `src/main/main-paths.test.ts`

- [x] **Step 1: 写 userData 路径测试**

断言新安装使用 Claude360 Copilot 数据目录，不沿用 Kun/DeepSeek GUI 目录作为默认目录。

- [x] **Step 2: 写 legacy 迁移非目标测试**

断言第一阶段不会自动导入旧 Kun 会话或旧 DeepSeek GUI 数据，除非用户显式触发已有导入功能。

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/main-paths.test.ts src/main/app-identity.test.ts
```

Expected: FAIL 或旧断言需更新。

- [x] **Step 4: 实现新身份策略**

要求：

- 新 appId 视为新应用。
- 不破坏已有 legacy import 代码。
- 不自动清理旧 Kun 数据。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/main-paths.test.ts src/main/app-identity.test.ts
```

Expected: PASS。

## Task 3: 图标和窗口标题

**Files:**

- Replace/Create: `src/asset/img/claude360.png`
- Replace/Create: `src/asset/img/claude360_mac.png`
- Modify: `src/main/app-icon.ts`
- Modify: `electron-builder.config.cjs`
- Search/Modify: renderer 中窗口标题和品牌文案

- [x] **Step 1: 准备 Claude360 图标资源**

要求：

- Windows `.ico` 包含多尺寸。
- macOS 图标为圆角方块 + 透明边距。
- Linux 使用 PNG。

- [x] **Step 2: 写图标路径测试**

在 `packaging-config.test.ts` 或新增测试中断言 builder 配置指向 Claude360 图标路径。

- [x] **Step 3: 修改图标引用**

将 `kun.png`、`kun_mac.png`、`build/icon.ico` 的引用替换为 Claude360 资源。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/packaging-config.test.ts
```

Expected: PASS。

## Task 4: 路由骨架与可见功能清单

**Files:**

- Modify: `src/renderer/src/store/chat-store-types.ts`
- Modify: `src/renderer/src/store/chat-store.ts`
- Modify: `src/renderer/src/store/chat-store-navigation-actions.test.ts`
- Optional Create: `src/renderer/src/lib/feature-visibility.ts`
- Optional Test: `src/renderer/src/lib/feature-visibility.test.ts`

- [x] **Step 1: 写 route union 测试**

断言：

- `my`、`music`、`canvas` 是合法 route。
- `plugins`、`claw`、`schedule`、`workflow` 可保留类型但不在第一阶段 visible routes 中。

- [x] **Step 2: 写 visibility 测试**

如果新增 `feature-visibility.ts`：

```ts
expect(isPrimaryRouteVisible('plugins')).toBe(false)
expect(isPrimaryRouteVisible('my')).toBe(true)
```

- [x] **Step 3: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/lib/feature-visibility.test.ts
```

Expected: FAIL。

- [x] **Step 4: 实现 route 和 visibility**

保持集中定义，避免 Sidebar、WorkspaceModeTabs、SettingsView 各自硬编码一套隐藏逻辑。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/lib/feature-visibility.test.ts
```

Expected: PASS。

## Task 5: Sidebar 入口改造

**Files:**

- Modify: `src/renderer/src/components/chat/Sidebar.tsx`
- Modify tests under `src/renderer/src/components/chat/*Sidebar*.test.ts`

- [x] **Step 1: 写 Sidebar 渲染测试**

断言：

- 左下角显示“我的”入口。
- 可见主入口包含 Chat/Write/My/Canvas/Music。
- 不显示插件、手机连接、计划任务、Workflow 入口。
- 不渲染 `SidebarMascot`。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/chat/SidebarProjectsSection.test.ts src/renderer/src/components/chat/SidebarClawDialogHelpers.test.ts
```

根据现有测试文件实际拆分执行；若没有 Sidebar 主测试，新增 `src/renderer/src/components/chat/Sidebar.test.tsx`。

Expected: FAIL 或需要更新旧断言。

- [x] **Step 3: 修改 Sidebar**

要求：

- 使用 lucide 用户、图片、音乐图标。
- 左下角区域不放形象工坊。
- 隐藏入口时不删除旧 handler，避免引用错误。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/chat/Sidebar.test.tsx
```

Expected: PASS。

## Task 6: 停止渲染 cameo 和 celebration

**Files:**

- Modify: `src/renderer/src/components/Workbench.tsx`
- Modify: `src/renderer/src/components/chat/AnimatedWorkLogo.test.ts`
- Optional: keep `src/renderer/src/components/chat/AnimatedWorkLogo.tsx` unchanged

- [x] **Step 1: 写 Workbench 渲染测试**

断言 Workbench 不再包含 `IkunCameoLayer` 和 `KunCelebrationLayer`。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/workbench-plan-controller.test.ts src/renderer/src/components/chat/AnimatedWorkLogo.test.ts
```

Expected: 旧 cameo/celebration 相关测试失败或需调整。

- [x] **Step 3: 移除 Workbench 渲染引用**

从 `Workbench.tsx` 删除或注释渲染：

```tsx
<IkunCameoLayer />
<KunCelebrationLayer />
```

不要删除 `AnimatedWorkLogo.tsx` 文件本身，避免 UI plugin 相关类型连锁回归。

- [x] **Step 4: 更新测试**

将 `AnimatedWorkLogo.test.ts` 中对 SidebarMascot/cameo 可见性的断言改为：

- 组件可保留为内部 legacy 组件。
- 主工作台和 Sidebar 不渲染它。

- [x] **Step 5: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/chat/AnimatedWorkLogo.test.ts src/renderer/src/components/workbench-plan-controller.test.ts
```

Expected: PASS。

## Task 7: Settings 隐藏非核心功能

**Files:**

- Modify: `src/renderer/src/components/SettingsView.tsx`
- Modify: `src/renderer/src/components/settings-sections.tsx`
- Modify relevant settings section tests

- [x] **Step 1: 写 Settings 测试**

断言第一阶段设置页不显示：

- 插件市场。
- 手机连接。
- Schedule。
- Workflow。
- 形象工坊。
- 自定义供应商入口由计划 03 处理。

- [x] **Step 2: 运行失败测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/SettingsView.test.ts
```

若当前没有该测试，则新增。

Expected: FAIL。

- [x] **Step 3: 应用 visibility policy**

Settings 的导航和 lazy import 保持可维护，不在多个位置复制隐藏数组。

- [x] **Step 4: 运行测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/renderer/src/components/SettingsView.test.ts
```

Expected: PASS。

## Task 8: 品牌文本扫描

**Files:**

- Search scope: `claude360-Copilot/src`、`claude360-Copilot/package.json`、`claude360-Copilot/electron-builder.config.cjs`
- Do not modify: `claude360-Copilot/doc/01-*.md` 到 `07-*.md`

- [x] **Step 1: 扫描旧品牌词**

Run:

```bash
cd "claude360-Copilot"
rg -n "Kun|DeepSeek GUI|deepseek-gui|iKun|Ikun" "src" "package.json" "electron-builder.config.cjs"
```

Expected: 只剩必须保留的 runtime/internal 兼容名称，用户可见文案不应出现旧品牌。

- [x] **Step 2: 替换用户可见文案**

只替换 UI、标题、安装器、权限说明、错误提示中的旧品牌。不要盲目改 runtime 包名和历史迁移注释，避免破坏兼容。

- [x] **Step 3: 再次扫描**

Run:

```bash
cd "claude360-Copilot"
rg -n "Kun|DeepSeek GUI|deepseek-gui|iKun|Ikun" "src" "package.json" "electron-builder.config.cjs"
```

Expected: 剩余项都有明确技术原因。

## Task 9: 回归验证

- [x] **Step 1: 运行相关测试**

Run:

```bash
cd "claude360-Copilot"
npm run test -- src/main/app-identity.test.ts src/main/packaging-config.test.ts src/main/main-paths.test.ts src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/components/chat/AnimatedWorkLogo.test.ts
```

Expected: PASS。

- [x] **Step 2: 类型检查**

Run:

```bash
cd "claude360-Copilot"
npm run typecheck
```

Expected: PASS。

- [x] **Step 3: 构建验证**

Run:

```bash
cd "claude360-Copilot"
npm run build
```

Expected: PASS。

- [ ] **Step 4: 打包抽样验证**

Run only when ready for packaging:

```bash
cd "claude360-Copilot"
npm run dist:linux
```

Expected: AppImage 名称包含 `Claude360-Copilot`。Windows/macOS 打包分别在目标平台执行。

## Risk Notes

- 新 appId 会被系统视为新应用，这符合用户已确认的“换 appId”决策。
- 不要删除隐藏功能底层代码，第一阶段只隐藏入口。
- 品牌词扫描不能机械替换所有 `kun`，因为 runtime 包、配置文件、导入路径仍可能依赖该命名。
- 图标资源更新需要实际视觉检查，避免打包后显示硬边方块或旧图标缓存。
