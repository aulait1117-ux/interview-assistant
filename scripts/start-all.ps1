# 全サービス起動スクリプト（本番用）
# バックエンド自動再起動あり、フロントエンド・Electronも一括起動

$Root = Split-Path $PSScriptRoot -Parent

Write-Host "=== 面接アシスタント 全サービス起動 ===" -ForegroundColor Cyan

# 既存プロセスをクリーンアップ
Write-Host "[1/3] 既存プロセスをクリーンアップ..."
Get-Process python, py -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$existing = Get-NetTCPConnection -LocalPort 8000, 5173 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

# バックエンド（自動再起動ループ付き、新しいウィンドウで）
Write-Host "[2/3] バックエンド起動（自動再起動あり）..."
Start-Process powershell -ArgumentList "-NoExit", "-File", "$Root\scripts\start-backend.ps1" -WindowStyle Normal

Start-Sleep -Seconds 5

# バックエンド起動確認
$backendOk = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $r = Invoke-RestMethod "http://localhost:8000/health" -TimeoutSec 2
        if ($r.status -eq "ok") { $backendOk = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if ($backendOk) {
    Write-Host "  バックエンド: OK" -ForegroundColor Green
} else {
    Write-Host "  バックエンド: タイムアウト（続行）" -ForegroundColor Yellow
}

# フロントエンド
Write-Host "[3/3] フロントエンド起動..."
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$Root\frontend" -NoNewWindow

Start-Sleep -Seconds 4

# Electronオーバーレイ
Write-Host "[4/4] Electronオーバーレイ起動..."
Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run overlay:dev" `
    -WorkingDirectory $Root -NoNewWindow

Write-Host ""
Write-Host "=== 起動完了 ===" -ForegroundColor Green
Write-Host "ブラウザ: http://localhost:5173" -ForegroundColor Cyan
Write-Host "バックエンドAPI: http://localhost:8000" -ForegroundColor Cyan
