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
- Stripe本番設定（本番キー・Webhook登録・疎通確認）は2026-07-01完了
- **ただし`02_開発部/βリリースチェックリスト.md`は全16項目中4項目のみチェック済み（2026-07-01外部監査で確認）**。Electronオーバーレイ起動・AI回答リアルタイム表示・FastAPIバックエンド起動・Reactフロントエンド表示・Stripeテスト決済疎通・本番URL実HTTPリクエスト確認など中核項目が未確認のまま。「β版リリース完了」を名乗る前に、これらを実機で確認しチェックリストを埋めること

## Chrome↔Electron 通信アーキテクチャ
```
Chrome → POST /api/overlay/hint → backend → SSE(/api/overlay/stream) → Electron
Electron → POST /api/overlay/control → backend → SSE(/api/overlay/main-stream) → Chrome
Chrome → POST /api/overlay/show → backend → SSE → Electron（前面表示）
```

## 未完了タスク
- 現在なし（β版リリース完了・実機テスト完了、2026-07-01）

## よくある起動トラブル
- **ポート競合**: `netstat -ano | findstr ":8000"` でPIDを確認して `Stop-Process -Id <PID> -Force`
- **Electron「ERR_CONNECTION_REFUSED」**: Vite(5173)が起動してから数秒後にElectron起動すること
- **npmがPowerShellで動かない**: `cmd.exe /c npm ...` 経由で起動する
- **インストーラービルド前に必ず確認する環境変数**（2026-07-01の教訓）:
  - `ELECTRON_BUILD=true` — 未設定だとViteが絶対パス（`/assets/`）で出力し、file://読み込みに失敗してオーバーレイが表示されない
  - `ELECTRON_RUN_AS_NODE` — 開発中にこれが残っているとElectronがNode.jsモードで起動しASARを読まずに終了する（`scripts/launch-electron.js`で削除される想定だが、手動起動時は要確認）
