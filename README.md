# 面接アシスタント

Zoom面接中にリアルタイムで模範回答をオーバーレイ表示するデスクトップアプリ。

## 構成

| レイヤー | 技術 | 役割 |
|---|---|---|
| バックエンド | FastAPI (Python 3.11) | API・認証・決済・音声文字起こし |
| フロントエンド | React + TypeScript (Vite) | メイン画面・セットアップ |
| オーバーレイ | Electron | Zoomの上に透過表示 |

```
Chrome (localhost:5173)
  ↕ SSE / REST
FastAPI (localhost:8000)
  ↕ SSE
Electron オーバーレイ
```

## セットアップ

### 必要なもの

- Python 3.11+
- Node.js 20+
- Anthropic API キー
- OpenAI API キー（Whisper音声文字起こし用）

### 手順

```powershell
# 1. リポジトリをクローン
git clone https://github.com/aulait1117-ux/interview-assistant.git
cd interview-assistant

# 2. 環境変数を設定
cp .env.example .env
# .env を編集して各APIキーを入力

# 3. バックエンド依存関係をインストール
cd backend
pip install -r requirements.txt
cd ..

# 4. フロントエンド依存関係をインストール
cd frontend
npm install
cd ..

# 5. Electronオーバーレイ依存関係をインストール
npm install
```

## 起動

```powershell
# バックエンド（ポート8000）
cd backend
py -m uvicorn main:app --port 8000 --reload

# フロントエンド（ポート5173） — 別ターミナルで
cd frontend
npm run dev

# Electronオーバーレイ — 別ターミナルで
npm run overlay:dev
```

ブラウザで `http://localhost:5173` を開く。

## 機能

- **透過オーバーレイ**: Zoomの上に常駐（alwaysOnTop）。マウス貫通対応
- **リアルタイム音声文字起こし**: OpenAI Whisper APIで録音→テキスト変換
- **AI模範回答生成**: Anthropic Claude APIで応募者情報に最適化した回答を生成
- **ショートカットキー**: SetupFormで録音トリガーキーを設定可能
- **認証**: メール/パスワード + Google Sign-In
- **決済**: Stripe / PayPay（要APIキー設定）

## プラン

| プラン | 価格 | 利用時間 |
|---|---|---|
| 無料トライアル | ¥0 | 3分 |
| 1日1時間 | ¥500 | 60分 |
| 1日使い放題 | ¥1,000 | 24時間 |
| 月額 | ¥2,000 | 無制限 |
| 月額（割引）| ¥1,000 | 無制限 ※1日プラン利用者限定 |

## デプロイ

バックエンド・フロントエンドともに Render へデプロイ。`render.yaml` に設定済み。

| サービス | URL |
|---|---|
| バックエンド | https://interview-assistant-hrar.onrender.com |
| フロントエンド | https://interview-assistant-frontend.onrender.com |

Stripe webhook登録先: `https://interview-assistant-hrar.onrender.com/api/billing/stripe/webhook`

## 環境変数

`.env.example` を参照。
