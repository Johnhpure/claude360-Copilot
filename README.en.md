<p align="center">
  <img src="src/asset/img/claude360.png" width="104" alt="Claude360 Copilot icon">
</p>

<h1 align="center">Claude360 Copilot</h1>

<p align="center">
  <strong>One account, four workbenches: Code · Write · Image · Music.</strong><br>
  Powered by the Claude360 relay, it puts an AI agent into real workflows — not just another chat box.
</p>

<p align="center">
  <a href="./README.md">简体中文</a>
  &nbsp;·&nbsp;
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="https://github.com/Johnhpure/claude360-Copilot/releases">Download</a>
  &nbsp;·&nbsp;
  <a href="#core-workbenches">Features</a>
  &nbsp;·&nbsp;
  <a href="#path-b-run-from-source">Run from source</a>
</p>

<p align="center">
  <a href="https://github.com/Johnhpure/claude360-Copilot/releases"><img src="https://img.shields.io/github/v/release/Johnhpure/claude360-Copilot?label=release" alt="GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" alt="License: PolyForm Noncommercial 1.0.0"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white" alt="Electron 34">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
</p>

**Claude360 Copilot** is a cross-platform desktop AI workbench. Sign in with a single Claude360 account and do **coding, writing, image generation, and music creation** in one app — no more juggling multiple websites, subscriptions, and API keys.

Unlike chat-only clients, it puts AI into real work: the Code workbench binds to a local codebase to read/edit files, run commands, and review every change; the Write workbench is a full Markdown authoring environment; the Image and Music workbenches bring text-to-image / image-to-image and Suno music creation right into the desktop. All model requests are routed through the **Claude360 relay** (OpenAI-compatible style), with accounts, groups, rate multipliers, and keys managed in-app.

Sessions, logs, preferences, and runtime data stay on your machine by default; API keys are stored encrypted in the main process and never persisted in plaintext. For flows that read/write files or run commands, the app provides tool approvals, permission modes, inline diffs, and a change-review panel.

---

<p align="center">
  <a href="src/asset/img/code.mp4">
    <img src="src/asset/img/code.gif" width="410" alt="Code workbench demo">
  </a>
  <a href="src/asset/img/write.mp4">
    <img src="src/asset/img/write.gif" width="410" alt="Write workbench demo">
  </a>
</p>

## Core Workbenches

Claude360 Copilot condenses four high-frequency creative scenarios into four workbenches that share one account, group config, and local runtime.

### 🧩 Code — Requirement-Driven Agent Coding

Instead of "one prompt, straight to code edits," it connects **requirement → design → plan → code → verify** into one continuous GUI workflow.

- Bind a local project folder to read code context, run shell commands, and edit files.
- Requirement drafts with AI clarification, pre-implementation research, structured requirement blocks, and acceptance criteria.
- `/plan` produces manageable implementation plans; move into todos, `/goal`, side conversations, thread compaction, forking, and archiving.
- Pre-commit inline diffs, a change-review panel, `/review`, tool approvals, and filesystem permission modes.
- Connect MCP (Model Context Protocol) servers and project/global Skills to extend tools per task.

### ✍️ Write — A Dedicated Markdown Studio

A writing workspace decoupled from Code, bringing agent assistance to long-form authoring.

- Markdown file tree with Live / Source / Split / Preview modes.
- AI inline completion, selection-based rewriting/polishing, and image attachments.
- One-click export to `HTML / PDF / DOC / DOCX`.

### 🎨 Image — Text-to-Image / Image-to-Image

A full parameter panel from prompt to picture, covering mainstream generation needs.

| Parameter | Options |
| --- | --- |
| Model | Determined by the image models available in the selected group |
| Reference image (optional) | Upload for image-to-image; omit for text-to-image |
| Aspect ratio | 10 presets (square / widescreen / portrait / print / feed, etc.) as an icon grid |
| Resolution | 1K / 2K / 4K |
| Count | Batch generation per run |
| Quality | Auto / High / Medium / Low |
| Output format | PNG / JPEG / WebP |

Paired with a history panel and a result grid for review and comparison.

### 🎵 Music — Suno Music Studio

Two creation modes, from spark to song.

- **One-shot**: just a model + a single-sentence description for a quick track.
- **Standard**: title + lyrics (with a built-in **✨ AI lyrics assistant** — streamed token-by-token, insert on accept) + style preset chips + negative style tags + instrumental toggle + advanced params (vocal gender / style weight / weirdness / persona).
- The track list shows returned cover art, with an enhanced player: seek, volume control, and previous/next queue playback.

## Account, Groups & Keys

Claude360 Copilot drops the old "add each provider / paste each API key" mental model in favor of **account → group → model**.

- **In-app sign-in**: web authorization or account password + 2FA — no manual key pasting.
- **Groups & Keys**: view your account's available groups (with rate multipliers) and their models, and manage API keys per group in Settings.
- **Auto key on demand**: when you pick a model in any workbench, the app checks whether that group already has a usable key — if not, an elegant modal appears, and on confirm it creates and back-fills the key without leaving the app.
- **Secure storage**: API keys are stored encrypted in the main process; no plaintext in the renderer or config files.

## Why Claude360 Copilot

| You want | Claude360 Copilot provides |
| --- | --- |
| One entry for many kinds of creation | Code / Write / Image / Music workbenches sharing one account and runtime |
| One account, one place to bill | Unified routing via the Claude360 relay; groups, multipliers, and keys managed in-app |
| AI that works on real projects | Bind a local workspace, read/edit files, search code, run commands, review changes |
| Requirements that become executable plans | Requirement drafts, `/plan`, todos, `/goal`, thread compaction, forking, and archiving |
| Controlled changes | Tool approvals, permission modes, inline diffs, a change-review panel, and `/review` |
| Writing in the same app | Markdown file tree, multiple preview modes, AI completion/rewrite, multi-format export |
| Direct image and music creation | Text/image-to-image parameter panel, Suno one-shot/standard creation with AI lyrics |
| Data and keys that stay local | Sessions/logs/config kept local; keys encrypted in the main process, never plaintext |

## More Demos

<p align="center">
  <a href="src/asset/img/pdf-research.mp4">
    <img src="src/asset/img/pdf-research.gif" width="680" alt="PDF research demo">
  </a>
</p>
<p align="center"><em>PDF research and source organization</em></p>

<p align="center">
  <a href="src/asset/img/sdd.mp4">
    <img src="src/asset/img/sdd.gif" width="680" alt="Requirement clarification, documents, and planning demo">
  </a>
</p>
<p align="center"><em>Requirement clarification, requirement documents, and implementation plans</em></p>

## Quick Start

### Path A: Download a Release

Download the latest build from [GitHub Releases](https://github.com/Johnhpure/claude360-Copilot/releases).

| Platform | Package | Architecture |
| --- | --- | --- |
| Windows | `.zip` portable (unzip and run) | x64 |
| macOS | `.dmg` or `.zip` | Intel / Apple Silicon |
| Linux | `.AppImage` | x64 |

> Unsigned macOS builds require "Open Anyway" under System Settings → Privacy & Security on first launch, or right-click → Open.

### First Launch

1. Choose a UI language (defaults to **Simplified Chinese**).
2. Sign in to your Claude360 account: web authorization, or account password + 2FA.
3. Open any workbench and start creating — bind a local project in Code, or jump straight into Write / Image / Music.
4. If the selected group has no key yet, confirm the prompt to auto-create one.

### Path B: Run From Source

Requirements:

| Dependency | Version |
| --- | --- |
| Node.js | 20+ |
| npm | Ships with Node.js |
| Claude360 account | To sign in and obtain groups / models / keys |

```bash
git clone https://github.com/Johnhpure/claude360-Copilot.git
cd claude360-Copilot
npm install
npm run dev
```

For slower network access in mainland China, use an npm mirror:

```bash
npm install --registry=https://registry.npmmirror.com
```

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Build the local runtime and start the Electron dev app |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking (web + node tsconfigs) |
| `npm run lint` | ESLint checks |
| `npm run test` | Vitest tests |
| `npm run dist:win` | Build Windows packages locally (on Windows) |
| `npm run dist:mac` | Build macOS `.dmg` and `.zip` locally (on macOS) |
| `npm run dist:linux` | Build the Linux AppImage |

## Packaging & Release

Native modules (e.g. `node-pty`) cannot be cross-compiled, so **Windows and macOS installers must be built on their own platform or in CI**. The repo ships a GitHub Actions workflow, `.github/workflows/build-installers.yml`:

- Tag `v*` (e.g. `v0.2.0`): produce **all three platforms** in the cloud.
- Tag `win-v*` (e.g. `win-v0.1.3`): build **Windows x64 only** (a portable zip) for quick test builds.
- Or trigger manually via GitHub → Actions → Build Installers → Run workflow (with an optional `only_windows` toggle).

Download build artifacts from the **Artifacts** section at the bottom of the run page (`Claude360-Copilot-Windows-x64` / `Claude360-Copilot-macOS-Intel-x64` / `Claude360-Copilot-macOS-Apple-Silicon-arm64`, retained for 14 days). See the [packaging guide](doc/BUILD-打包环境与安装包.md) for full details.

## Configuration and Data

- Preferences, sessions, logs, and local runtime data stay on your machine by default.
- Model requests are routed through the Claude360 relay; groups, multipliers, and model lists are fetched with your account.
- API keys are stored encrypted in the main process; no plaintext in the renderer or config files.
- All four workbenches share one local runtime boundary (HTTP/SSE) for sessions, approvals, tools, and usage tracking.
- File writes, command execution, and MCP tools are governed by permissions and approvals.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Desktop framework | Electron 34 |
| Frontend | React 19 + TypeScript + Tailwind CSS |
| Build | electron-vite (Vite 6) |
| State | Zustand |
| Testing | Vitest |
| Runtime boundary | Built-in local runtime over HTTP/SSE, with a cache-first agent loop, append-only event logs, and context compaction |
| Relay | Claude360 relay (OpenAI-compatible style) |

## Documentation Map

| Doc | Contents |
| --- | --- |
| [doc/BUILD-打包环境与安装包.md](doc/BUILD-打包环境与安装包.md) | Packaging matrix, GitHub Actions cloud builds, and local builds (zh) |
| [docs/DEVELOPMENT.en.md](docs/DEVELOPMENT.en.md) | Local development workflow, branch strategy, and release notes |
| [docs/CONTRIBUTING.en.md](docs/CONTRIBUTING.en.md) | Contribution guide |
| [SECURITY.md](SECURITY.md) | Security disclosure policy |

## Contributing

Bug fixes, UI/UX improvements, documentation, localization, and build/release work are welcome.

- Before opening a PR, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` when possible.
- External contributions require acceptance of the [Contributor License Agreement](./CLA.md).

## License

This project is provided for learning and reference only and **may not be used for any commercial purpose**. Commercial use, commercial distribution, SaaS/hosted services, resale, or integration into commercial products requires separate written authorization from the author.

Educational institutions and public-interest educational organizations may use it for noncommercial teaching, research, coursework, experiments, and learning/reference purposes. See [PolyForm Noncommercial License 1.0.0](./LICENSE) for the full terms.

## Acknowledgements

Claude360 Copilot is built on top of an excellent open-source Electron agent client and deeply integrates the model capabilities of the Claude360 relay. Thanks to the upstream open-source community and everyone who contributes issues, ideas, code, and documentation.
