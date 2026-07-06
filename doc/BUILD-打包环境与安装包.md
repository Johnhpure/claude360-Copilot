# Claude360 Copilot 打包指引（Win x64 / Mac arm64 / Mac x64）

## 本机能力矩阵（Ubuntu 24.04 / x86_64）

| 目标 | 本机（Linux）能否打 | 说明 |
|---|---|---|
| Windows x64 (NSIS) | ❌ **不能** | 原生模块 `node-pty` 无 Windows 预编译产物，node-gyp 无法从 Linux 交叉编译（`node-gyp does not support cross-compiling`）。`better-sqlite3` 有预编译可跨平台，但 node-pty 卡死整条链。 |
| macOS arm64 / x64 | ❌ **不能** | `.app`/`.dmg` 生成依赖 macOS 独有工具链（hdiutil / codesign），electron-builder 无法在 Linux 产出。 |
| Linux x64 (AppImage) | ✅ 能 | `npm run dist:linux`（本机原生编译 node-pty），如需可本地打。 |

> 结论：**Win + 两个 Mac 目标都必须在对应平台/ CI 上打**。项目自身的发布流水线也把 Windows 与 macOS 放到对应 runner 上，印证此约束。

## 推荐路径：GitHub Actions 云端打包（已配好）

已新增工作流：**`.github/workflows/build-installers.yml`**（手动或 tag 触发、只产出安装包、不涉及 R2）。
- `build-macos`（矩阵任务）：`macos-15` 产出 **Mac Apple Silicon arm64** 的 `dmg` 与 `zip`，`macos-15-intel` 产出 **Mac Intel x64** 的 `dmg` 与 `zip`。
- `build-windows`（`windows-latest`）：产出 **Win x64** 的 NSIS 安装包与 `zip` 便携包。
- 原生模块（node-pty / better-sqlite3 / nut-js）在各自平台 runner 原生编译，无跨平台问题。

### 触发方式（二选一）
- **手动**：GitHub → Actions → Build Installers → Run workflow。可勾选 `only_windows` **仅打 Windows x64**（跳过 macOS job）。
- **打 tag 自动触发**：
  - `v*`（如 `v0.2.0`）：云端产出**三平台**安装包。
  - `win-v*`（如 `win-v0.1.3-test.1`）：**仅打 Windows x64**，用于测试阶段快速出 win 包。
  版本号取自标签（去掉 `win-`/`v` 前缀，须合法 semver）：
  ```bash
  git tag v0.2.0 && git push origin v0.2.0            # 三平台
  git tag win-v0.1.3-test.1 && git push origin win-v0.1.3-test.1  # 仅 Windows
  ```

### 使用步骤
1. 把改动推到 GitHub（仓库 `github.com/Johnhpure/claude360-Copilot`）：
   ```bash
   git add .github/workflows/build-installers.yml README.md README.en.md doc/BUILD-打包环境与安装包.md
   git commit -m "ci: split macos installer builds by architecture"
   git push
   ```
   > 注：本会话按约束**未执行任何 git 操作**，需你自行提交推送。
2. 手动 **Actions → Build Installers → Run workflow**，或直接推 `v*` 标签自动触发。
3. 构建完成后在该 run 页面底部 **Artifacts** 下载：
   - `Claude360-Copilot-macOS-Apple-Silicon-arm64`（Mac M 系列 `dmg`/`zip`）
   - `Claude360-Copilot-macOS-Intel-x64`（Mac Intel `dmg`/`zip`）
   - `Claude360-Copilot-Windows-x64`（Win x64 NSIS 安装包与 `zip` 便携包）
   - 产物保留 14 天。

### macOS 签名说明
- **默认无签名（ad-hoc）**：可安装，但首次打开需在「系统设置 → 隐私与安全性」点「仍要打开」，或右键→打开。
- **可选签名+公证**：Run workflow 时勾选 `mac_sign=true`，并在仓库 Secrets 配好：
  `MAC_CODESIGN_P12_BASE64`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。

## 备选：自有 Mac 本地打包
在一台 Mac 上：
```bash
npm ci
npm run dist:mac            # 无签名，产出 arm64+x64 dmg/zip
# 或（已配 Apple 凭据）：MAC_SIGN=1 npm run dist:mac:signed
```
产物在 `dist/Claude360-Copilot-*-mac-*`。

## 备选：自有 Windows 本地打包
在一台 Windows（x64，装好 Node 22 + VS Build Tools + Python）：
```bash
npm ci
npm run dist:win           # 产出 dist/Claude360-Copilot-*-win-x64.exe
```

## 产物命名
`Claude360-Copilot-<version>-<os>-<arch>.<ext>`，如
`Claude360-Copilot-0.1.0-win-x64.zip`（Windows 便携包）、`-mac-arm64.dmg`、`-mac-x64.dmg`。
