# 議事録アプリ (minutes)

マイク音声を録音し、ローカルの [whisper.cpp](https://github.com/ggerganov/whisper.cpp) で文字起こしする Next.js アプリです。

> **Note (P0):** ブラウザのマイク録音 + ローカル Whisper のみ対応。  
> Zoom システム音声・話者分離・バックグラウンド常駐は今後の予定 (P1/P2/P3) です。

## 必要なもの

- Node.js 18+
- [ffmpeg](https://ffmpeg.org/)（PATH 上、または `FFMPEG_BIN`）
- ビルド済み [whisper.cpp](https://github.com/ggerganov/whisper.cpp) の `whisper-cli`
- Whisper モデル（**多言語**推奨。例: `ggml-large-v3-turbo-q8_0.bin` / `ggml-base.bin`。英語専用 `*.en.bin` は日英切替不可）

## セットアップ

```bash
git clone https://github.com/zunda-raider/minutes.git
cd minutes
npm install
cp .env.example .env.local
```

`.env.local` を編集してパスを設定します:

| 変数 | 必須 | 説明 |
|------|------|------|
| `WHISPER_BIN` | Yes | `whisper-cli` の実行ファイルパス |
| `WHISPER_MODEL` | Yes | 多言語モデルのパス（日英切替なら `*.en.bin` 以外） |
| `FFMPEG_BIN` | No | ffmpeg（省略時は `ffmpeg`） |
| `TEMP_DIR` | No | 一時音声ディレクトリ |
| `WHISPER_LANG` | No | デフォルト言語（省略時 `ja`） |
| `WHISPER_LANGS` | No | 許可言語リスト（省略時 `ja,en`） |
| `OLLAMA_BASE_URL` | No | Ollama URL（省略時 `http://127.0.0.1:11434`） |
| `OLLAMA_MODEL` | No | 省略時 `llama3.2`（代替例: `gemma2`） |
| `OLLAMA_BIN` | No | ollama 実行ファイル（例: `/usr/local/bin/ollama`） |
| `TRANSLATE_PROVIDER` | No | `auto`（Ollama→OpenAI）/ `ollama` / `openai` |
| `OPENAI_API_KEY` | No | 任意のフォールバック用 |

### Windows の例

```env
WHISPER_BIN=C:/Users/you/nminutes/whisper.cpp/build/bin/Release/whisper-cli.exe
WHISPER_MODEL=C:/Users/you/nminutes/whisper.cpp/models/ggml-base.bin
FFMPEG_BIN=C:/path/to/ffmpeg.exe
WHISPER_LANG=ja
WHISPER_LANGS=ja,en
```

### macOS の例（量子化 multi-lingual）

```env
WHISPER_BIN=/Users/taiki714/Desktop/whisper/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=/Users/taiki714/Desktop/whisper/whisper.cpp/models/ggml-large-v3-turbo-q8_0.bin
FFMPEG_BIN=ffmpeg
WHISPER_LANG=ja
WHISPER_LANGS=ja,en
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
OLLAMA_BIN=/usr/local/bin/ollama
```

### Linux の例

```env
WHISPER_BIN=/usr/local/bin/whisper-cli
WHISPER_MODEL=/path/to/models/ggml-base.bin
FFMPEG_BIN=ffmpeg
WHISPER_LANG=ja
WHISPER_LANGS=ja,en
```


## Ollama ローカル翻訳

英語セグメントの「Ollamaでローカル翻訳」は、既定でローカル [Ollama](https://ollama.com) を使います（デフォルトモデル: **llama3.2**。代替: **gemma2**）。

```bash
# macOS
brew install ollama
ollama pull llama3.2   # 推奨デフォルト
ollama pull gemma2     # 任意
# この Mac の例: binary=/usr/local/bin/ollama / models=llama3.2:latest, gemma2:latest
```

`.env.local` 例:

```env
TRANSLATE_PROVIDER=auto
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
# OLLAMA_MODEL=gemma2
OLLAMA_BIN=/usr/local/bin/ollama
# 任意: Ollama 失敗時のフォールバック
# OPENAI_API_KEY=sk-...
```

### 自動起動（ローカル Next のみ）

`npm run dev` / `next start` で動かす **Node サーバー側**の `/api/translate` は、翻訳前に `http://127.0.0.1:11434` を確認し、ダウンしていれば `OLLAMA_BIN`（なければ `/usr/local/bin/ollama` や PATH の `ollama`）で `ollama serve` をデタッチ起動して短時間リトライします。

- **できる:** ローカルで Next を動かしているとき
- **できない:** ブラウザだけで Ollama を起動すること、Vercel 等のサーバーレス

起動に失敗した場合は、brew パス（`/usr/local/bin/ollama serve`）を含むエラーを UI に出します。

## 起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開き、言語（日本語 / English）を選んでから「録音開始」→「停止」で文字起こしします。
許可言語は `WHISPER_LANGS`（UI は `/api/config` 経由で同期）。




## ジャンル / 文脈

Home の「ジャンル / 文脈」欄に会議の種類を自由入力できます（localStorage に保存）。空欄なら従来どおり。入力があると `/api/translate` と `/api/summarize` のプロンプトに渡し、用語・要約の精度を上げます。

## 要約

「要約」ボタンで文字起こし全体（古い順、日本語訳があれば併記）を Ollama（`OLLAMA_MODEL`）に送り、議題・決定・アクションの日本語箇条書きを生成します。結果は localStorage（`minutes.transcript.summary.v1`）に保存され、「要約クリア」または履歴クリアで消えます。

## 履歴の永続化

文字起こし履歴（`id` / `note` / `text` / `lang` / `at` / `textJa`）はブラウザの **localStorage**（キー `minutes.transcript.entries.v1`）に保存され、リロード後も残ります。Home / Note 1 / Note 2 は同じストアを参照します。「履歴をクリア」で削除します。

## 使い方の注意

- マイク許可が必要です。
- 録音中はタブを閉じないでください（バックグラウンド常駐は未対応）。
- 録音中も約 25 秒ごとにセグメントを Whisper へ送ります（録音と文字起こしは並行）。結果は**新しい順**に履歴表示。言語は **日本語 / English ボタン**で切替。英語結果は **Ollama ローカル翻訳**（任意で OpenAI フォールバック）できます。
- Zoom の相手音声を取るにはシステム音声 / ループバックが必要です（未実装）。

## 技術スタック

- Next.js 15 (App Router) + React 19 + TypeScript
- クライアント: `MediaRecorder`（1 秒 timeslice）
- サーバー: `ffmpeg` → `whisper-cli`

## ロードマップ

- **P0:** 録音バグ修正・パスの環境変数化・CSS / Node25 localStorage 修正
- **言語切替:** UI で ja/en を選択し `whisper-cli -l` に渡す（本機能）
- **P1:** 音声ソース切替（Zoom/システム音声）・チャンクアップロード・visibility 警告
- **P2:** 話者分離 (diarization)
- **P3:** Electron/Tauri などデスクトップ常駐


## Troubleshooting

### `TypeError: localStorage.getItem is not a function` (GET / 500)

This is a **Node.js 25+** issue: experimental Web Storage exposes a broken `localStorage` (warning: `--localstorage-file` was provided without a valid path). Our app code does not use `localStorage`; Next.js / tooling hits it during SSR.

Mitigations already in this repo:
- `scripts/polyfill-localstorage.cjs` is preloaded by `npm run dev|build|start`
- `instrumentation.ts` + `next.config.ts` also patch on server boot

Workarounds if it still happens:
- Prefer **Node 20 or 22 LTS** (`engines` recommends `<25`)
- Or disable the experiment: `node --no-experimental-webstorage node_modules/next/dist/bin/next dev`

## License

Private / TBD
