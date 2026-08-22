# PiClaw — 自托管 AI 工作区

![PiClaw](docs/icon-256.png)

语言：[English](README.md) · **简体中文** · [日本語](README.ja.md)

PiClaw 将 [Pi Coding Agent](https://github.com/badlogic/pi-mono) 打包成一个自托管工作区，提供三语流式 Web UI、持久状态、多提供商 LLM 支持和内置工具。[可选插件](https://rcarmo.github.io/piclaw-addons/)可扩展运行时和 Web UI。

它可以在本地或容器中运行，提供一个有状态的 agent 工作区。

## 功能

![演示动画](docs/demo.gif)

| 功能 | 说明 |
|---|---|
| Web 工作区 | 在同一个 UI 中使用聊天、编辑器、终端、查看器、上传和自动化功能 |
| 持久状态 | 基于 SQLite 的消息、媒体、任务、token 使用量、加密钥匙串和会话级 SSH 配置 |
| 内置工具 | 代码编辑、CSV/PDF/图片/视频查看、VNC、浏览器自动化、图像处理、MCP，以及用于成对远端实例的可选跨实例 IPC |
| Agent 工作流 | Steering、排队 follow-up、side prompt、计划任务和可视化 artifact 生成；可选的 autoresearch 插件提供实验循环 |
| 分阶段加载工具 | 默认保持较小的常驻工具集，通过 `list_tools` 和 `list_scripts` 发现更多工具 |
| 可选认证和通道 | Web UI 支持 passkey 或 TOTP，也可选接入 WhatsApp |
| 可选插件 | 提供额外工具、技能、查看器、终端、设置面板、Draw.io、Office 文档渲染和工具、Windows 桌面自动化、Proxmox 与 Portainer |

## 快速开始

```bash
mkdir -p ./home ./workspace

docker run -d \
  --init \
  --name piclaw \
  --restart unless-stopped \
  -p 8080:8080 \
  -e PICLAW_WEB_PORT=8080 \
  -v "$(pwd)/home:/config" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/rcarmo/piclaw:latest
```

打开 `http://localhost:8080`，输入 `/login` 配置 LLM 提供商，包括自定义 OpenAI 兼容端点和本地 [llama.cpp router preset](docs/llama-cpp.md)。Web UI 内置英语、简体中文和日语文案，可在设置中切换语言。

> [!TIP]
> 对 `docker run` / `podman run` 保持启用 `--init`，这样运行时会插入一个很小的 init 进程，用于转发信号和回收僵尸进程。随附的 `docker-compose.yml` 现在也设置了等效的 `init: true` 标志。

| 挂载 | 容器路径 | 内容 |
|---|---|---|
| Home | `/config` | 持久化 Pi 状态（`.pi/`）和 Git 配置（`.gitconfig`） |
| Workspace | `/workspace` | 项目、笔记和 piclaw 状态 |

> [!NOTE]
> 在容器镜像中，`/home/agent/.pi` 由 `/config/.pi` 支撑。使用上面的 `docker run` 示例或随附的 [`docker-compose.yml`](docker-compose.yml) 时，Pi home 状态会持久保存在主机的 `./home/.pi/agent/` 下。
>
> 这意味着 provider 登录状态和模型元数据如果存放在以下文件中，重建或重新创建容器后仍会保留：
>
> - `./home/.pi/agent/auth.json`
> - `./home/.pi/agent/models.json`

> [!WARNING]
> 绝不要删除 `/workspace/.piclaw/store/messages.db`。它是聊天历史、媒体、任务及运行日志、token 使用量、加密钥匙串、passkey、Web 会话和聊天分支的事实来源。

> [!IMPORTANT]
> 你**不需要**在 piclaw 环境变量里设置 provider API key。PiClaw 会复用 Pi Agent 设置中配置的 provider 凭据。

> [!NOTE]
> 工作区级 shell 环境覆盖可写入 `/workspace/.env.sh`。PiClaw 会在内置终端和运行时启动期间 source 该文件。它适合设置 `PATH`，或通过 `GH_CONFIG_DIR=/workspace/.config/gh` 指定持久化的 GitHub CLI 配置目录。无效内容可能破坏启动、shell 行为或工具解析。

## Web UI 概览

PiClaw 是单用户、移动端友好的，并通过 SSE 流式推送更新。

| 区域 | 亮点 |
|---|---|
| 聊天 | 思考/草稿面板、steering、排队 follow-up、Adaptive Cards、`/btw`、链接预览、线程化轮次、恢复/超时 chip |
| 语言 | 英语、简体中文和日语 UI 文案，并带有设置内语言切换器 |
| 状态 UX | 静默探测期间工具/意图状态保持可见，最近活动会恢复有用上下文，工具行可在 meta 行显示紧凑的 `x ago` 提示 |
| 工作区 | 侧边栏浏览器、拖放上传、文件引用 pill、explorer 搜索/重建索引状态 |
| 编辑器 | CodeMirror 6、搜索/替换、dirty 状态跟踪、语法高亮、延迟加载的本地 bundle |
| 终端 | 内置 xterm.js Web 终端，可作为 dock 或 tab；支持可分离弹窗；Ghostty 作为可选插件单独提供 |
| 查看器 | 内置 CSV/TSV、PDF、图片、视频、代码预览和 VNC pane；可选插件提供 Draw.io、Office 查看器后端和看板 |
| 自动化 | 内置 `image_process`、`cdp_browser` 和 `mcp`；配置 Azure OpenAI/Foundry 后可用 `/image` 与 `/flux`；Microsoft 365 和 Windows 桌面自动化由可选插件提供 |

完整功能导览见 [docs/web-ui.md](docs/web-ui.md)。

> [!NOTE]
> 内置 xterm.js 实现是默认终端渲染器。Ghostty/WASM 渲染器通过可选的 [`@rcarmo/piclaw-addon-ghostty-terminal`](https://rcarmo.github.io/piclaw-addons/addons/ghostty-terminal/) 插件单独提供。

## 配置

常用环境变量：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PICLAW_WEB_PORT` | `8080` | Web UI 端口 |
| `PICLAW_WEB_TERMINAL_ENABLED` | Linux/macOS 为 `1`，Windows 为 `0` | 启用或禁用经过认证的内置 Web 终端 |
| `PICLAW_WEB_VNC_ALLOW_DIRECT` | Linux/macOS/Windows 为 `1` | 允许或禁用运行时提供的直接 VNC 目标 |
| `PICLAW_WEB_TOTP_SECRET` | _（空）_ | Base32 TOTP secret；启用登录门禁（也可用 `/totp` 初始化） |
| `PICLAW_WEB_PASSKEY_MODE` | `totp-fallback` | `totp-fallback`、`passkey-only` 或 `totp-only` |
| `PICLAW_ASSISTANT_NAME` | `PiClaw` | UI 中显示的名称 |
| `PICLAW_KEYCHAIN_KEY` | _（空）_ | 加密 secret 存储的主密钥 |
| `PICLAW_TRUST_PROXY` | `0` | 位于反向代理或隧道后方时启用 |

完整列表、TOTP/passkey 设置、会话级 SSH-backed 远程工具、反向代理配置和工作区环境 hook，见 [docs/configuration.md](docs/configuration.md)。

## 其他安装方式

### 不使用 Docker 安装

```bash
bun add -g github:rcarmo/piclaw
```

实验性。支持 Linux/macOS/Windows。见 [docs/install-from-repo.md](docs/install-from-repo.md)。

Windows 支持仍处于实验阶段。类 shell 子进程在 Windows 上以附加模式运行（`detached=false`），因此 stdout 和 stderr 仍可捕获。类 Unix 主机使用分离进程组，以便 abort 和 shutdown 终止完整进程树。

### 实验性桌面壳

PiClaw 还有一个可选的 Electrobun 桌面包装器，包裹现有本地 Web UI：

```bash
bun run build:desktop
```

桌面壳会在 `127.0.0.1` 上启动 Piclaw，使用从 `18080` 起的可用端口，打开原生窗口，并把默认工作区存储在平台应用数据目录下。设置 `PICLAW_DESKTOP_URL` 可包装一个已经运行的 Piclaw Web 服务器，而不是再启动一个。

### 从源码构建

见 [docs/development.md](docs/development.md)。

## 文档

| 区域 | 文档 |
|---|---|
| 入门 | [配置](docs/configuration.md)、[Web UI](docs/web-ui.md)、[从仓库安装](docs/install-from-repo.md) |
| 运维 | [Azure VM 部署](docs/azure/README.md)、[Azure OpenAI 扩展](docs/azure/azure-openai-extension.md)、[反向代理](docs/reverse-proxy.md)、[发布流程](docs/release.md) |
| 运行时内部 | [架构](docs/architecture.md)、[插件运行时 API](docs/addon-runtime-api.md)、[流水线智能压缩](docs/pipelined-compaction.md)、[运行时流程](docs/runtime-flows.md)、[运行时流式会话](docs/runtime-stream-sessions.md)、[存储模型](docs/storage.md)、[可观测性](docs/observability.md) |
| UI 扩展模型 | [Web pane 扩展](docs/web-pane-extensions.md)、[扩展 UI 契约](docs/extension-ui-contract.md)、[Vendored widget 库](docs/vendored-widget-libraries.md) |
| Agent 能力 | [工具和技能](docs/tools-and-skills.md)、[可视化 artifact 生成器](docs/visual-artifact-generator.md)、[通过 pi-mcp-adapter 使用 MCP](docs/mcp.md)、[钥匙串](docs/keychain.md) |
| 其他参考 | [Dream 记忆系统](docs/dream-memory.md)、[思考状态持久化](docs/thinking-persistence.md)、[Web 通知交付策略](docs/web-notification-delivery-policy.md)、[iOS PWA 参考](docs/PWA.md)、[WhatsApp](docs/whatsapp.md)、[Remote Peer 插件](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/)、[Microsoft 365 插件](https://rcarmo.github.io/piclaw-addons/addons/m365/)、[开发](docs/development.md) |
| 平台研究 | [Azure Functions 可行性研究](docs/azure/azure-functions-feasibility-study-2026-04-17.md) |

## 贡献

工作项和 bug 报告在 **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)** 中跟踪。

- [提交工作项或 bug 报告](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [提问](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [查看项目看板](https://github.com/users/rcarmo/projects/13)

看板泳道定义和分诊分类请以 issue 模板和项目看板标签为准。

## 鸣谢

- [pi.dev](http://pi.dev)，提供 PiClaw 使用的 Pi core
- [rcarmo/agentbox](https://github.com/rcarmo/agentbox)
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — Tobi Lutke 和 David Cortés 的自主实验循环（现在由 `rcarmo/piclaw-addons` 中的 autoresearch 插件承载）
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — Nico Bailon 的可视化 artifact 生成技能理念、prompt 工作流和模板模式（已改编，非 vendored）

> [!NOTE]
> piclaw 与 [pi.dev](https://pi.dev) **没有**直接关联。它是基于 Pi core 的衍生作品，并提供自己的运行时、工具和 UI。

## 许可证

MIT
