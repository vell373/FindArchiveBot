# Notion MCP Discord Bot

Discord でメンションされた質問に対し、Notion MCP 上のデータベースを検索し、Chat GPT で整形した回答を即時返す TypeScript 製 Bot です。

## システム概要

- **実行環境**: Render Web Service（Node.js 20）
- **データソース**: Notion MCP REST API
- **AI エンジン**: OpenAI Chat Completion API
- **トリガー**: Discord メンションのみ（@here,@everyone は反応しない）
- **会話コンテキスト**: 単発 QA モード（履歴なし）
- **プロンプト**: .txt ファイルで管理

## 主要コンポーネント

- **GatewayManager**: Discord WS 接続・Heartbeat・Resume
- **MessageParser**: メンション検知・テキスト抽出
- **PromptManager**: プロンプトファイル管理
- **GPTClient**: OpenAI API 呼出し（再試行付）
- **NotionAdapter**: MCP API 検索
- **Formatter**: 取得データを回答プロンプトへ変換
- **DiscordResponder**: Discord API 応答管理
- **ErrorHandler**: 例外分類／通知
- **Logger**: JSON ログ + TraceID

## セットアップ

### 前提条件

- Node.js 20.x 以上
- npm または yarn
- Discord Bot Token
- OpenAI API キー
- Notion MCP API キー

### インストール

1. リポジトリをクローン
```bash
git clone <repository-url>
cd notion-mcp-discord-bot
```

2. 依存パッケージをインストール
```bash
npm install
```

3. 環境変数を設定
`.env.example` ファイルを `.env` にコピーし、必要な情報を入力してください。

```
# Discord設定
DISCORD_TOKEN=your_discord_token_here

# OpenAI設定
OPENAI_API_KEY=your_openai_api_key_here

# Notion MCP設定
MCP_API_KEY=your_mcp_api_key_here
MCP_API_BASE_URL=your_mcp_api_base_url_here

# ログ設定
LOG_LEVEL=info
```

### ビルドと実行

1. TypeScriptをコンパイル
```bash
npm run build
```

2. アプリケーションを起動
```bash
npm start
```

開発モードで実行する場合:
```bash
npm run dev
```

## 使用方法

1. Bot をサーバーに招待
2. Bot をメンションして質問を投稿
   例: `@NotionMCPBot Notion MCPデータベースの構造について教えて`
3. Bot が質問を処理し、回答を返信

## プロンプトのカスタマイズ

`src/prompts` ディレクトリ内のテキストファイルを編集することで、検索キーワード抽出や回答生成のプロンプトをカスタマイズできます。

- `search_prompt.txt`: 質問からキーワードを抽出するためのプロンプト
- `answer_prompt.txt`: 検索結果から回答を生成するためのプロンプト

## Notion MCP データベース設計ガイド

Bot が検索対象とする Notion MCP データベースは、以下のプロパティを含むことを推奨します：

### 必須プロパティ
- **タイトル**: レコードを識別する主キー（検索結果の見出し）
- **URL**: 関連する外部ページや資料へのリンク
- **概要**: 本文や要旨（200文字程度）
- **使用ツール**: 使用したサービス・ソフトウェア名（マルチセレクト）
- **カテゴリ**: コンテンツの分類（マルチセレクト）

## エラーハンドリング

Bot は以下のエラーを適切に処理し、ユーザーフレンドリーなメッセージを返します：

- Discord レート制限
- OpenAI API エラー
- Notion MCP API エラー
- ネットワークエラー
- バリデーションエラー

## ライセンス

MIT
