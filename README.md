# 議事録アプリ (minutes)

マイク音声を録音し、ローカルの [whisper.cpp](https://github.com/ggerganov/whisper.cpp) で文字起こしする Next.js アプリです。

> **Note:** マイク録音に加え、**Zoom・LINE・その他アプリ / システム音声**（`getDisplayMedia` + システム音声）に対応。  
> 話者分け（手動ラベル + 任意で tinydiarize / embedding）対応。バックグラウンド常駐は P3。

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
| `WHISPER_MODEL` | Yes | 多言語モデルのパス（日英切替なら `*.en.bin` 以外）。Home / Note / Zoom は常にこれ |
| `WHISPER_MODEL2` | No | GDライブ用の速いモデル（例: `ggml-small-q8_0.bin`）。未設定なら `WHISPER_MODEL` にフォールバック |
| `FFMPEG_BIN` | No | ffmpeg（省略時は `ffmpeg`） |
| `TEMP_DIR` | No | 一時音声ディレクトリ |
| `WHISPER_LANG` | No | デフォルト言語（省略時 `ja`） |
| `WHISPER_LANGS` | No | 許可言語リスト（省略時 `ja,en`） |
| `OLLAMA_BASE_URL` | No | Ollama URL（省略時 `http://127.0.0.1:11434`） |
| `OLLAMA_MODEL` | No | 省略時 `llama3.2`（代替例: `gemma2`） |
| `OLLAMA_BIN` | No | ollama 実行ファイル（例: `/usr/local/bin/ollama`） |
| `TRANSLATE_PROVIDER` | No | `auto`（Ollama→OpenAI）/ `ollama` / `openai` |
| `OPENAI_API_KEY` | No | 任意のフォールバック用 |
| `WHISPER_DIARIZE` | No | `1` で自動話者分けを試行 |
| `WHISPER_DIARIZE_MODE` | No | `tdrz` / `embedding` / `extra` |
| `WHISPER_SPEAKER_MODEL` | No | embedding 用スピーカーモデル |
| `WHISPER_DIARIZE_ARGS` | No | whisper-cli 追加引数 |


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
WHISPER_MODEL2=/Users/taiki714/Desktop/whisper/whisper.cpp/models/ggml-small-q8_0.bin
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

Home の「ジャンル / 文脈」はメニュー内と、Note 1 / Note 2 と同じ行の小さい入力の両方にあります。画面上の Status（Idle / Recording / Transcribing）表示はありません。同じ値で、localStorage に保存されます。空欄なら従来どおり。入力があると `/api/translate` と `/api/summarize` のプロンプトに渡し、用語・要約の精度を上げます。


## 話者分け（diarization）

Home の **手動 / 自動** トグルでモードを切り替えます（`minutes.speakers.mode.v1`）。

- **マイク:** 重い A〜G UI は出さず、**メインスピーカー / 質問者** の役割ボタンのみ。録音中の選択役割に新しい文字起こしが付きます。カードのメタ行は `#N` と時刻に加え、控えめな短いラベルだけです（メイン＝`自分`、質問者＝`質問者`）。自分（メイン）は緑、それ以外はグレーです。本文に話者名タグは出しません。
- **Zoom / システム + 自分の自動判定:** 録音中だけマイクも並行して開く（文字起こしは共有音声のまま）。Whisper の各区間でマイク RMS とシステム RMS を比べ、マイク優勢なら **自分**（A）、システムだけなら **それ以外**（C）、両方小さいときは未設定。マイクを拒否された場合は自動判定せず、従来の手動 / 自動に戻る。区間の途中で話者ボタンを押したセグメントは手動が優先。マイクのみの録音ではこの比較はしない。
- **Zoom / システム + 手動:** **セミナー / 自分 / それ以外** と A〜G を録音中に常時表示し、いまの話者を約 **60秒** 区切りにスタンプします。**自動** のときだけこの録音中ピッカーは出しません。**手動** では常に出します。**GDモード** は話者分けの切替ではなく、GD議事録の専用画面へ移動します。保存済みの文字起こしを選んで「分析する」と、Ollama を1回だけ呼び、航海（前進 / 脱線 / 停滞）と論点の木を表示します。入口はライブ画面で、出航準備とは別です。ライブ終了から分析へ進むフックは未接続です。終わったあと Home / Note でカードをドラッグするか文字を選択し、出る **自分 / セミナー / それ以外** でまとめて付けられます（自分＝A、セミナー＝B、それ以外＝C）。メタ行は `#N 自分` / `#N セミナー` / `#N それ以外`（D〜G を任意で選んだときだけ文字）。自分（A）は緑、それ以外はグレーです。コピーの「セミナーだけ」は B、「自分＋その他」は A と C〜G のままです。
- **Zoom + 自動:** tinydiarize 優先、なければピッチで仮の A/B…。「ピッチで付け直す」で再推定。

### 自動話者分け（任意）

現在の既定モデル（例: `ggml-large-v3-turbo-q8_0.bin`）は **tinydiarize 非対応**です。自動を使う場合:

1. **tinydiarize（推奨・実験的・英語）**
   ```bash
   # whisper.cpp
   ./models/download-ggml-model.sh small.en-tdrz
   ```
   `.env.local`:
   ```env
   WHISPER_DIARIZE=1
   WHISPER_DIARIZE_MODE=tdrz
   WHISPER_MODEL=/path/to/ggml-small.en-tdrz.bin
   WHISPER_LANG=en
   ```
   `whisper-cli` に `-tdrz` を付け、出力の `[SPEAKER_TURN]` を解析して話者を交互に付与します。

2. **embedding diarize**（whisper.cpp を diarize 対応ビルドしスピーカーモデルがある場合）
   ```env
   WHISPER_DIARIZE=1
   WHISPER_DIARIZE_MODE=embedding
   WHISPER_SPEAKER_MODEL=/path/to/ggml-speaker-ecapa-tdnn.bin
   ```

3. **任意引数**
   ```env
   WHISPER_DIARIZE=1
   WHISPER_DIARIZE_MODE=extra
   WHISPER_DIARIZE_ARGS=-tdrz
   ```

未対応フラグや未設定時は **通常の文字起こしにフォールバック**し、UI に日本語の警告を出します。手動ラベルは常に使えます。

## 録音ダウンロード

セグメント音声（ブラウザ `MediaRecorder` の webm など）は **IndexedDB** に保存されます。各カードの「録音をダウンロード」、または「録音をまとめてダウンロード」で ZIP（無圧縮ストア）として一括取得できます。履歴クリアで音声も削除されます。リロード後も IndexedDB に残っている分は再ダウンロード可能です。


## GDモード（ライブ）

Home の **GDモード** を開くと、先にライブ画面です（分析の出航準備は右上の **出航準備**）。議論中の見た目だけを確かめる画面で、2トラック音声はまだ使いません。約12分のダミー発言が、実時間で流れます。

本番の文字起こしは **文字起こし: 速い / 精密** で切り替えます。初期値は速い方（`WHISPER_MODEL2`）。精密は Home と同じ `WHISPER_MODEL` です。選択は `minutes.gd.whisperModelKey.v1` に残ります。`WHISPER_MODEL2` が空なら速いも精密と同じモデルになります。

1. お題に、目指す結論を一行で入れる（例: 一人でも当日動ける案内を渡す）
2. **開始**。左が他者、右が自分。新しい発言が上に出て、古い発言は下へ押し出される
3. 速度は **1x / 2x / 4x**。4x なら約12分が約3分。制限時間は 12:00
4. 序盤のあと、自分だけ長い無言がある。右レーンの空白が、秒数ではなく色で濃くなる
5. その後、自分の長いひとり話と、短いキャッチボールが入る。時間に入りきらない長文は端に「長文」
6. **論点切替** に短い名前（例: 前提、ターゲット、施策）を入れて押すと、上の論の流れが `前提→ターゲット→施策` のように繋がり、いまの論点だけ光る。レーンを横切る仕切りが、その時刻に入る
7. **終了** で時計が止まる。もう一度 **開始** で最初から。航海の分析へは自動では進まない

縦位置は経過時間どおりなので、無言は空白のまま残ります。中央の軸は1分ごとの目盛りです。
下段の左は **論理の木** です。上のお題が目的です。その下に **大論点** と、中の **論点** を手で足せます（追加・名前の変更・削除）。行をクリックするか「いま」で、**いま話してる** を付けられます。これは上の **論点切替**（時間の仕切り）とは別です。木と AIコメントは `minutes.gd.logicTree.v1` に残ります。

木の下は **AIコメント** です。手でも直せます。**論点整理** は、画面に出ている直近の文字起こしと今の木を `/api/gd-organize` から Ollama（`OLLAMA_MODEL`）へ一度送り、コメントと既存ノードへの短い印（薄い / 十分 / 脱線 / 停滞）だけを更新します。木の追加や改名はしません。議論中でも押せます。整理中は **中止** で打ち切れます。毎分の自動整理はありません。航海用の `/api/gd-analyze` は止めたままです。

## GDモード（結果）

Home の **GDモード** から **出航準備** を開きます（音声ソースは **Zoom・LINE・他**）。このブラウザの文字起こし履歴（`minutes.transcript.entries.v1`）が一覧になるので、試したい発言を選んで **分析する** を押します。ライブを終了しても、自動ではこの画面へ進みません。履歴が残っていれば、録音し直さずに結果画面を試せます。

`/api/gd-analyze` が Ollama（`OLLAMA_BASE_URL` / `OLLAMA_MODEL`、任意でジャンル文脈）を **終了時の1回だけ** 呼びます。返すのは次の3つです。

いまこの経路は止めてあり、`/api/gd-analyze` は 503 を返します。ライブ中の **論点整理** だけが `/api/gd-organize` で Ollama を使います。

1. 議論の結論（一文）
2. 親子関係のある論点
3. 各カード番号（`#N`）の論点と効果（前進 / 脱線 / 停滞）

話者（自分 / 他者）はモデルに訊かず、アプリの話者ラベル（speaker id 1 = 自分）を使います。JSON が壊れても画面は落とさず、警告を出します。

上段の **航海** は左が出発、右が結論の島です。船は発言順に進み、前進だけ島へ近づきます。脱線は航路から外れ、停滞はその場です。自分の発言には旗が付きます。下段の **木** は論点を枝、発言を葉、自分の発言を果実で示します。枝をクリックするとその論点の発言一覧が出ます。

## 要約

「要約」ボタンで文字起こし全体（古い順、日本語訳があれば併記）を Ollama（`OLLAMA_MODEL`）に送り、議題・決定・アクションの日本語箇条書きを生成します。結果は localStorage（`minutes.transcript.summary.v1`）に保存され、「要約クリア」または履歴クリアで消えます。

## 履歴の永続化

文字起こし履歴（`id` / `note` / `text` / `lang` / `at` / `textJa`）はブラウザの **localStorage**（キー `minutes.transcript.entries.v1`）に保存され、リロード後も残ります。Home / Note 1 / Note 2 は同じストアを参照します。「履歴をクリア」で削除します。

## 使い方の注意

- マイク許可が必要です。
- 録音中はタブを閉じないでください（バックグラウンド常駐は未対応）。
- 録音中も約 25 秒ごとにセグメントを Whisper へ送ります（録音と文字起こしは並行）。結果は**新しい順**に履歴表示。言語は **日本語 / English ボタン**で切替。英語結果は **Ollama ローカル翻訳**（任意で OpenAI フォールバック）できます。
- **Zoom・LINE・その他アプリ / システム音声:** Home の「Zoom・LINE・他」を選び Record → **Zoom / LINE / その他通話アプリ**のウィンドウ・タブ・画面を共有し、ダイアログで **システム音声を共有** をオンにします（同じ `getDisplayMedia` パイプライン）。Chrome などでは `systemAudio: "include"` / `windowAudio: "system"` を要求します。
- macOS で音声トラックが取れない場合は [BlackHole](https://existential.audio/blackhole/) などの仮想オーディオでアプリ出力をマイクへルーティングし、「マイク」モードで録音してください。

## 技術スタック

- Next.js 15 (App Router) + React 19 + TypeScript
- クライアント: `MediaRecorder`（1 秒 timeslice）
- サーバー: `ffmpeg` → `whisper-cli`

## ロードマップ

- **P0:** 録音バグ修正・パスの環境変数化・CSS / Node25 localStorage 修正
- **言語切替:** UI で ja/en を選択し `whisper-cli -l` に渡す（本機能）
- **P1:** 音声ソース切替（Zoom・LINE・他 / システム音声）✅ · チャンクアップロード · visibility 警告
- **P2:** 話者分離 (diarization) ✅（手動 + 任意 tinydiarize/embedding）
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
