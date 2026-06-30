# 面接サポートサイト — 開発引き継ぎドキュメント

## 新セッション開始時の最初のアクション
1. このCLAUDE.mdを読む
2. 以下の起動コマンドでサービスを起動する
3. ユーザーの指示を待つ（説明不要、コードは全部実装済み）

## 起動方法

### 本番（推奨）：全サービス一括起動
```powershell
powershell -File "C:\企業道\02_開発部\interview_assistant\scripts\start-all.ps1"
```
バックエンドはクラッシュしても自動で再起動します。

### 個別起動（開発時）
```powershell
# バックエンド（自動再起動あり）
powershell -File "C:\企業道\02_開発部\interview_assistant\scripts\start-backend.ps1"

# フロントエンド（ポート5173）
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" -WorkingDirectory "C:\企業道\02_開発部\interview_assistant\frontend" -NoNewWindow

# Electronオーバーレイ（Zoomの上に常駐）
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run overlay:dev" -WorkingDirectory "C:\企業道\02_開発部\interview_assistant" -NoNewWindow
```

ブラウザ: `http://localhost:5173`

## プロジェクト構成
- バックエンド: FastAPI (Python) / `backend/`
- フロントエンド: React + TypeScript / `frontend/src/`
- Electronオーバーレイ: `electron/`（Zoomの上に透過表示）
- 音声文字起こし: `backend/routes/speech.py`（OpenAI Whisper API）

## 主要ファイル
| ファイル | 役割 |
|---|---|
| `frontend/src/components/RealtimeMode.tsx` | 面接メイン画面（録音・ヒント・ショートカット） |
| `frontend/src/components/OverlayApp.tsx` | Electronオーバーレイ本体 |
| `frontend/src/components/SetupForm.tsx` | セットアップ画面（ショートカットキー設定） |
| `frontend/src/hooks/useSpeechRecognition.ts` | 音声録音→Whisper文字起こし |
| `electron/main.js` | Electronメインプロセス |
| `electron/overlay-preload.js` | オーバーレイ用IPCブリッジ |
| `backend/routes/overlay.py` | SSE中継（Chrome↔Electron連携） |
| `backend/routes/speech.py` | Whisper文字起こしエンドポイント |
| `backend/routes/billing.py` | Stripe決済 |

## 実装済み機能
- **Electronオーバーレイ**: Zoomの上に常駐（alwaysOnTop: screen-saver）
- **全辺リサイズ**: メインプロセスのカーソルポーリング方式
- **透明度スライダー・文字色ピッカー**: オーバーレイ内で調整可能
- **マウス貫通**: 透明領域はクリック通過、パネルhover時だけ操作可能
- **「💡 ヒントを見る」ボタン**: Electronオーバーレイを前面に呼び出し
- **録音ボタン（オーバーレイ内）**: POST /api/overlay/control → Chrome側でマイクトグル
- **録音ショートカットキー**: SetupFormで設定（localStorage保存）
- **OpenAI Whisper API**: 音声→テキスト変換（POST /api/speech/transcribe）
- **SSE中継**: Chrome↔Electronのヒント・コマンド双方向通信
- **Stripe決済コード**: 実装済み（APIキー・webhook設定は未完了）

## 現在の問題（未解決）
- **音声録音→文字起こしが動かない**
  - `useSpeechRecognition.ts` でMediaRecorder APIを使用
  - 録音ボタンは機能する（isListening切り替わる）
  - しかし `stopListening` 内の `setTranscript` が反映されない
  - `onstop`ハンドラが発火していない疑い
  - デバッグコードあり（blob.size表示など）
  - 原因不明のまま保留
  - **次回セッションで継続調査が必要**

## Chrome↔Electron 通信アーキテクチャ
```
Chrome → POST /api/overlay/hint → backend → SSE(/api/overlay/stream) → Electron
Electron → POST /api/overlay/control → backend → SSE(/api/overlay/main-stream) → Chrome
Chrome → POST /api/overlay/show → backend → SSE → Electron（前面表示）
```

## 未完了タスク
- **音声録音バグ修正**（最優先）
- **Stripe本番設定**（荒川さん側の作業）
  - `STRIPE_SECRET_KEY` を `backend/.env` とRender環境変数に設定
  - Stripeダッシュボードでwebhook登録: `https://interview-assistant-hrar.onrender.com/api/billing/stripe/webhook`

## よくある起動トラブル
- **ポート競合**: `netstat -ano | findstr ":8000"` でPIDを確認して `Stop-Process -Id <PID> -Force`
- **Electron「ERR_CONNECTION_REFUSED」**: Vite(5173)が起動してから数秒後にElectron起動すること
- **npmがPowerShellで動かない**: `cmd.exe /c npm ...` 経由で起動する
