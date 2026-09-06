# PiClaw — セルフホスト型 AI ワークスペース

![PiClaw](docs/icon-256.png)

言語：[English](README.md) · [简体中文](README.zh-CN.md) · **日本語**

PiClaw は [Pi Coding Agent](https://github.com/badlogic/pi-mono) を、三言語対応のストリーミング Web UI、永続状態、複数プロバイダーの LLM 対応、組み込みツールを備えたセルフホスト型ワークスペースとしてまとめます。[任意のアドオン](https://rcarmo.github.io/piclaw-addons/)でランタイムと Web UI を拡張できます。

ローカルまたはコンテナーで、状態を保持する 1 つの agent ワークスペースとして実行できます。

## 機能

![デモアニメーション](docs/demo.gif)

| 機能 | 詳細 |
|---|---|
| Web ワークスペース | チャット、エディター、ターミナル、ビューアー、アップロード、自動化を同じ UI で利用 |
| 永続状態 | SQLite ベースのメッセージ、メディア、タスク、トークン使用量、暗号化キー管理、セッション単位の SSH プロファイル |
| 組み込みツール | コード編集、CSV/PDF/画像/動画ビューアー、VNC、ブラウザー自動化、画像処理、MCP、ペアリングしたリモート peer 向けの任意のクロスインスタンス IPC |
| Agent ワークフロー | Steering、キュー付き follow-up、side prompt、スケジュールタスク、視覚的 artifact 生成。任意の autoresearch アドオンは実験ループを提供 |
| 段階的なツール読み込み | 常時有効なツールを小さく保ち、`list_tools` と `list_scripts` で追加ツールを発見 |
| 任意の認証とチャネル | Web UI の passkey または TOTP、および任意の WhatsApp 連携 |
| 任意のアドオン | 追加ツール、スキル、ビューアー、ターミナル、設定ペイン、Draw.io、Office 文書の描画とツール、Windows デスクトップ自動化、Proxmox、Portainer |

## クイックスタート

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

`http://localhost:8080` を開き、`/login` と入力して LLM プロバイダーを設定します。OpenAI 互換のカスタムエンドポイントと、ローカルの [llama.cpp router preset](docs/llama-cpp.md) も設定できます。Web UI には英語、簡体字中国語、日本語の文字列が同梱され、設定で言語を切り替えられます。

> [!TIP]
> `docker run` / `podman run` では `--init` を有効にしたままにしてください。ランタイムが小さな init プロセスを挿入し、シグナル転送とゾンビプロセスの回収を行います。同梱の `docker-compose.yml` も同等の `init: true` フラグを設定しています。

| マウント | コンテナーパス | 内容 |
|---|---|---|
| Home | `/config` | 永続化された Pi 状態（`.pi/`）と Git 設定（`.gitconfig`） |
| Workspace | `/workspace` | プロジェクト、ノート、piclaw 状態 |

> [!NOTE]
> コンテナーイメージでは、`/home/agent/.pi` は `/config/.pi` によって支えられています。上記の `docker run` 例または同梱の [`docker-compose.yml`](docker-compose.yml) を使う場合、Pi home の状態はホスト側の `./home/.pi/agent/` 以下に永続化されます。
>
> つまり、プロバイダーログイン状態やモデルメタデータを次のようなファイルに保存しておけば、再ビルドや再作成後も残るはずです。
>
> - `./home/.pi/agent/auth.json`
> - `./home/.pi/agent/models.json`

> [!WARNING]
> `/workspace/.piclaw/store/messages.db` は絶対に削除しないでください。これはチャット履歴、メディア、タスクと実行ログ、トークン使用量、暗号化キー、passkey、Web セッション、チャットブランチの信頼できる保存元です。

> [!IMPORTANT]
> piclaw の環境変数に provider API key を設定する必要は**ありません**。PiClaw は Pi Agent 設定で構成された provider 認証情報を再利用します。

> [!NOTE]
> ワークスペース単位の shell 環境上書きは `/workspace/.env.sh` に置けます。PiClaw は組み込みターミナルとランタイム起動時にこのファイルを source します。`PATH` の調整や、`GH_CONFIG_DIR=/workspace/.config/gh` による永続的な GitHub CLI 設定に使用できます。無効な内容は起動、shell 動作、ツール解決を壊す可能性があります。

## Web UI 概要

現在サポートされる PiClaw の構成はシングルユーザー向けで、モバイルに対応し、SSE で更新を配信します。

家族アカウントと隔離コンテナーのモードは開発中です。バックエンドにはセッション所有権、アカウント管理、アカウントごとの複数パスキーが実装されていますが、どちらのマルチユーザーモードもまだ起動できません。家族向けの設定・ログイン UI と自動移行は未完成です。[アクセスモードと実装状況（英語）](docs/multi-user/README.md)を確認し、データベースを変更して起動制限を回避しないでください。

| 領域 | ハイライト |
|---|---|
| チャット | 思考/ドラフトパネル、steering、キュー付き follow-up、Adaptive Cards、`/btw`、リンクプレビュー、スレッド化された turn、復旧/タイムアウト chip |
| 言語 | 英語、簡体字中国語、日本語の UI 文字列と、設定内の言語スイッチャー |
| ステータス UX | 無音のプローブ中もツール/意図ステータスを表示し、最近のアクティビティから有用な文脈を復元。ツール行は meta 行にコンパクトな `x ago` ヒントを表示可能 |
| ワークスペース | サイドバーのブラウザー、ドラッグ＆ドロップアップロード、ファイル参照 pill、explorer 検索/再インデックス状態 |
| エディター | CodeMirror 6、検索/置換、dirty 状態追跡、シンタックスハイライト、遅延読み込みのローカル bundle |
| ターミナル | dock または tab として使える組み込み xterm.js Web ターミナル、切り離し可能なポップアウト、Ghostty は任意アドオンとして別途提供 |
| ビューアー | 組み込みの CSV/TSV、PDF、画像、動画、コードプレビュー、VNC pane。任意のアドオンは Draw.io、Office ビューアーバックエンド、kanban を提供 |
| 自動化 | 組み込みの `image_process`、`cdp_browser`、`mcp`。Azure OpenAI/Foundry 設定時の `/image` と `/flux`。Microsoft 365 と Windows デスクトップ自動化は任意のアドオンが提供 |

完全な機能ツアーは [docs/web-ui.md](docs/web-ui.md) を参照してください。

> [!NOTE]
> 組み込みの xterm.js 実装がデフォルトのターミナルレンダラーです。Ghostty/WASM レンダラーは任意の [`@rcarmo/piclaw-addon-ghostty-terminal`](https://rcarmo.github.io/piclaw-addons/addons/ghostty-terminal/) アドオンとして別途提供されます。

## 設定

一般的な環境変数：

| 変数 | 既定値 | 目的 |
|---|---|---|
| `PICLAW_WEB_PORT` | `8080` | Web UI ポート |
| `PICLAW_WEB_TERMINAL_ENABLED` | Linux/macOS は `1`、Windows は `0` | 認証付き組み込み Web ターミナルの有効/無効 |
| `PICLAW_WEB_VNC_ALLOW_DIRECT` | Linux/macOS/Windows で `1` | 実行時に指定される直接 VNC ターゲットの許可/禁止 |
| `PICLAW_WEB_TOTP_SECRET` | _（空）_ | Base32 TOTP secret。ログインゲートを有効化（または `/totp` で初期化） |
| `PICLAW_WEB_PASSKEY_MODE` | `totp-fallback` | `totp-fallback`、`passkey-only`、`totp-only` |
| `PICLAW_ASSISTANT_NAME` | `PiClaw` | UI に表示される名前 |
| `PICLAW_KEYCHAIN_KEY` | _（空）_ | 暗号化 secret 保存用の master key |
| `PICLAW_TRUST_PROXY` | `0` | リバースプロキシまたはトンネルの背後にある場合に有効化 |

完全な一覧、TOTP/passkey 設定、セッション単位の SSH-backed リモートツール、リバースプロキシ設定、ワークスペース環境 hook については [docs/configuration.md](docs/configuration.md) を参照してください。

## その他のインストール方法

### Docker なしでインストール

```bash
bun add -g github:rcarmo/piclaw
```

実験的です。Linux/macOS/Windows 対応。詳細は [docs/install-from-repo.md](docs/install-from-repo.md) を参照してください。

Windows 対応は実験的です。shell 風の子プロセスは Windows では attached（`detached=false`）で実行されるため、stdout と stderr を捕捉できます。Unix 系ホストでは分離プロセスグループを使い、abort と shutdown でプロセスツリー全体を終了できます。

### 実験的なデスクトップシェル

PiClaw には、既存のローカル Web UI を包む任意の Electrobun デスクトップラッパーもあります。

```bash
bun run build:desktop
```

デスクトップシェルは `127.0.0.1` 上で Piclaw を起動し、`18080` から始まる空きポートを使ってネイティブウィンドウを開き、既定のワークスペースを各プラットフォームのアプリケーションデータディレクトリに保存します。すでに動作中の Piclaw Web サーバーを包みたい場合は、`PICLAW_DESKTOP_URL` を設定してください。

### ソースからビルド

[docs/development.md](docs/development.md) を参照してください。

## ドキュメント

| 領域 | ドキュメント |
|---|---|
| はじめに | [設定](docs/configuration.md)、[Web UI](docs/web-ui.md)、[リポジトリからインストール](docs/install-from-repo.md) |
| 運用 | [Azure VM デプロイ](docs/azure/README.md)、[Azure OpenAI 拡張](docs/azure/azure-openai-extension.md)、[リバースプロキシ](docs/reverse-proxy.md)、[リリース手順](docs/release.md) |
| ランタイム内部 | [アーキテクチャ](docs/architecture.md)、[アドオンランタイム API](docs/addon-runtime-api.md)、[パイプライン化スマート圧縮](docs/pipelined-compaction.md)、[ランタイムフロー](docs/runtime-flows.md)、[ランタイムストリームセッション](docs/runtime-stream-sessions.md)、[ストレージモデル](docs/storage.md)、[可観測性](docs/observability.md) |
| UI 拡張モデル | [Web pane extensions](docs/web-pane-extensions.md)、[Extension UI contract](docs/extension-ui-contract.md)、[Vendored widget libraries](docs/vendored-widget-libraries.md) |
| Agent 機能 | [ツールとスキル](docs/tools-and-skills.md)、[Visual artifact generator](docs/visual-artifact-generator.md)、[pi-mcp-adapter 経由の MCP](docs/mcp.md)、[キー管理](docs/keychain.md) |
| その他のリファレンス | [Dream memory system](docs/dream-memory.md)、[Thinking persistence](docs/thinking-persistence.md)、[Web notification delivery policy](docs/web-notification-delivery-policy.md)、[iOS PWA reference](docs/PWA.md)、[WhatsApp](docs/whatsapp.md)、[Remote Peer アドオン](https://rcarmo.github.io/piclaw-addons/addons/remote-peer/)、[Microsoft 365 アドオン](https://rcarmo.github.io/piclaw-addons/addons/m365/)、[開発](docs/development.md) |
| プラットフォーム調査 | [Azure Functions feasibility study](docs/azure/azure-functions-feasibility-study-2026-04-17.md) |

## コントリビューション

作業項目とバグ報告は **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)** で管理されています。

- [作業項目またはバグ報告を開く](https://github.com/rcarmo/piclaw/issues/new?template=workitem.md)
- [質問する](https://github.com/rcarmo/piclaw/issues/new?template=question.md)
- [プロジェクトボードを見る](https://github.com/users/rcarmo/projects/13)

ボードの lane 定義と triage taxonomy については、issue template と project board の label を基準にしてください。

## クレジット

- [pi.dev](http://pi.dev) — PiClaw が使用する Pi core の提供
- [rcarmo/agentbox](https://github.com/rcarmo/agentbox)
- [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
- [davebcn87/pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) — Tobi Lutke と David Cortés による自律実験ループ（現在は `rcarmo/piclaw-addons` の autoresearch アドオンが担っています）
- [nicobailon/visual-explainer](https://github.com/nicobailon/visual-explainer) — Nico Bailon による視覚的 artifact 生成スキルの思想、prompt ワークフロー、テンプレートパターン（adapted、vendored ではありません）

> [!NOTE]
> piclaw は [pi.dev](https://pi.dev) と直接の提携関係には**ありません**。Pi core を基に、独自のランタイム、ツール、UI を提供する派生作品です。

## ライセンス

MIT
