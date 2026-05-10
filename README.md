# Task App

## 概要

Task App は、個人の業務管理を想定して作成したタスク管理アプリです。

単にタスクを登録するだけではなく、タスクごとに「メール」「電話」「その他」の対応履歴を残せるようにし、後から対応経緯を確認しやすい構成にしています。

また、Ollama を利用したローカルAI秘書チャット機能を追加し、現在のタスク一覧や対応履歴をもとに、次にやるべきことの整理やタスク編集の補助を行えるようにしています。

日々の業務で発生する「次に何をするか」「いつ対応するか」「過去にどんな連絡をしたか」「AIに相談して優先順位を整理すること」をまとめて管理することを目的としています。

## 公開URL

https://task-app-kappa-eight.vercel.app

## 使用技術

- Next.js
- React
- TypeScript
- Tailwind CSS
- localStorage
- API Routes
- Google Apps Script 連携
- Python
- Ollama
- PWA
- Vercel

## 主な機能

### タスク管理

- タスクの新規登録
- タスクの編集
- タスクの削除
- open / closed の状態管理
- closed タスクの再オープン
- closed タスクの自動削除

### 期限管理

- 次回対応日時の登録
- 期限が空のタスクを一覧上部に表示
- 期限が近いタスクの視覚的アラート
- 期限切れタスクの視覚的アラート

### 履歴管理

- タスクごとの対応履歴登録
- 履歴タイプの分類
  - email
  - phone
  - other
- 件名の登録
- メモの登録
- 履歴日時の登録
- 履歴の編集
- 履歴のソフト削除
- 削除済み履歴の自動削除

### データ保存・同期

- localStorage によるローカル保存
- API Routes 経由での外部同期
- Google Apps Script との連携
- ローカルデータと外部データのマージ
- JSON形式でのバックアップ
- JSON形式での復元

### AI秘書チャット

- スマホWeb画面からAIへメッセージ送信
- Google Apps Script を経由したAIメッセージ保存
- PC側の Python AI Worker による未処理メッセージ監視
- Ollama へのプロンプト送信
- AIの返信を Google Apps Script へ書き戻し
- Web画面へのAI返信表示
- 通常モード / ディープモードの切り替え
- タスク編集前確認のON / OFF切り替え
- タスク削除系操作を禁止する安全ルール

### PWA対応

- Service Worker によるキャッシュ制御
- ネットワーク不安定時でも利用しやすい構成
- スマートフォン・PCの両方で利用しやすい画面設計

## AI機能の構成

このアプリでは、Webアプリ側とPC上のローカルAI処理を分けて構成しています。

```text
スマホ / PCのWeb画面
  ↓
Next.js API Routes
  ↓
Google Apps Script
  ↓
PC上の Python AI Worker
  ↓
Ollama
  ↓
AI返信を Google Apps Script へ書き戻し
  ↓
Web画面に表示
```

Webアプリ側では、`/ai` 画面からAIへメッセージを送信します。
送信されたメッセージは `/api/ai-messages` を通じて Google Apps Script 側へ保存されます。

PC上では `ai/ai_worker.py` を起動し、未処理のAIメッセージを定期的に取得します。
取得したメッセージに、現在のタスク一覧、プロフィール、長期記憶を組み合わせてOllamaへ送信し、AIの返信を再びGoogle Apps Scriptへ書き戻します。

## AI機能で工夫した点

### 1. ローカルLLMを使ったAI秘書機能

Ollamaを利用することで、PC上のローカルLLMをタスク管理アプリと連携できるようにしました。

Webアプリ自体はスマートフォンから利用し、AI処理はPC側のPython Workerで行う構成にしています。

### 2. 通常モード / ディープモードの切り替え

AIチャットでは、通常モードとディープモードを切り替えられるようにしています。

通常モードでは短く実用的に返答し、ディープモードでは理由や優先順位を深く整理する想定です。

### 3. タスク編集前の確認フロー

AIがタスクを追加・編集・クローズ・再オープン・履歴追加・次回対応日時変更などを提案する場合、すぐに実行せず、まず変更予定の内容を提示するルールを入れています。

これにより、AIが勝手にタスクを書き換えることを防ぎ、ユーザーが確認してから反映できる設計にしています。

### 4. profile.md / memory.md による個人向けプロンプト設計

`ai/profile.md` と `ai/memory.md` を読み込み、AIがユーザーの生活・仕事・学習・家庭の優先順位を踏まえて返答できるようにしています。

単なるチャットではなく、「何から手をつければいいか分からない状態」を減らすためのタスク管理AIとして設計しています。

### 5. Google Apps Scriptを中継に使った構成

スマートフォンから送ったメッセージをPC上のOllamaで処理するため、Google Apps Scriptを中継地点として利用しています。

これにより、Webアプリ、タスクデータ、AIメッセージ、PC上のローカルAI処理をつなげています。

## 工夫した点

### 1. タスクと対応履歴を分けて管理

通常のタスク管理では「やること」は管理できても、「過去にどんな対応をしたか」が残しにくいと感じました。

そのため、タスク本体とは別に履歴データを持たせ、メール・電話・その他の対応を時系列で残せるようにしました。

### 2. 業務で使うことを想定した期限アラート

次回対応日時が過ぎているタスクや、30分以内に対応が必要なタスクを視覚的に分かるようにしました。

これにより、一覧を見たときに優先度の高いタスクを判断しやすくしています。

### 3. ローカル保存と外部同期の両立

localStorage に保存することで、ブラウザ上で素早く操作できるようにしています。

さらに、API Routes を経由して Google Apps Script と連携し、外部データとの同期も行える構成にしました。

### 4. バックアップ・復元機能

ブラウザのlocalStorageだけに依存すると、データ消失の不安があります。

そのため、JSON形式で手動バックアップ・復元できる機能を追加し、データを自分で退避できるようにしました。

### 5. 日付入力の扱いやすさ

日付・時刻入力では、入力途中に値が消えたりUTC変換で時刻がずれたりしないよう、日付と時刻を分けて扱い、ローカル時刻として処理するようにしています。

## 起動方法

### 1. リポジトリをクローン

```bash
git clone https://github.com/ot0Yo58/task-app.git
```

### 2. ディレクトリに移動

```bash
cd task-app
```

### 3. 依存関係をインストール

```bash
npm install
```

### 4. 開発サーバーを起動

```bash
npm run dev
```

### 5. ブラウザで確認

```bash
http://localhost:3000
```

## AI Workerの起動方法

AI機能を利用する場合は、PC側でOllamaとPython Workerを起動します。

### 1. Ollamaを起動

事前にOllamaをインストールし、利用するモデルを用意します。

例：

```bash
ollama pull qwen2.5:3b
ollama pull qwen3:8b
```

### 2. Python側の環境変数を設定

`ai/.env` に以下を設定します。

```env
GAS_URL=Google Apps Script のURL
GAS_TOKEN=任意の認証トークン
OLLAMA_NORMAL_MODEL=qwen2.5:3b
OLLAMA_DEEP_MODEL=qwen3:8b
```

### 3. Python Workerを起動

```bash
cd ai
python ai_worker.py
```

Workerを起動すると、Google Apps Script側の未処理メッセージを定期的に取得し、Ollamaで処理して返信を書き戻します。

## 環境変数

Next.js 側で Google Apps Script と同期する場合は、以下の環境変数を設定します。

```env
TASK_APP_GAS_URL=Google Apps Script のURL
TASK_APP_GAS_TOKEN=任意の認証トークン
```

環境変数が未設定の場合、外部同期やAIメッセージ連携は利用できませんが、localStorage によるローカル保存は利用できます。

## ディレクトリ構成

```text
task-app/
├── ai/
│   ├── ai_worker.py
│   ├── profile.md
│   └── memory.md
├── app/
│   ├── ai/
│   │   └── page.tsx
│   ├── api/
│   │   ├── ai-messages/
│   │   │   └── route.ts
│   │   └── tasks/
│   │       └── route.ts
│   ├── page.tsx
│   ├── layout.tsx
│   └── globals.css
├── public/
│   ├── manifest.webmanifest
│   └── sw.js
├── package.json
└── README.md
```

## 今後の改善予定

- ログイン機能の追加
- ユーザーごとのタスク管理
- DB保存への移行
- AIによるタスク編集の実行処理
- AIによる履歴要約
- タスク検索機能
- タスクのカテゴリ分け
- スマートフォンでの操作性向上
- AI Workerの起動手順の簡略化

## 制作目的

このアプリは、学習目的だけでなく、実際の業務管理で使うことを意識して作成しました。

タスクの登録・編集だけでなく、対応履歴、期限管理、データ保存、バックアップ、同期、AIによる整理補助まで含めて設計することで、より実用に近いアプリケーションを目指しています。
