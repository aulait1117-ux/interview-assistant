# 面接アシスタント 起動スクリプト

Write-Host "=== 面接アシスタント起動 ===" -ForegroundColor Cyan

# .env チェック
if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Host "[ERROR] .env ファイルが見つかりません。" -ForegroundColor Red
    exit 1
}

# バックエンド起動（別ウィンドウ）
Write-Host "バックエンド起動中..." -ForegroundColor Green
$backendDir = "$PSScriptRoot\backend"
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", "py -m uvicorn main:app --port 8000" `
    -WorkingDirectory $backendDir

Start-Sleep -Seconds 3

# フロントエンド起動（別ウィンドウ）
Write-Host "フロントエンド起動中..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", "npm run dev" `
    -WorkingDirectory "$PSScriptRoot\frontend"

Start-Sleep -Seconds 5

# Electronオーバーレイ起動（別ウィンドウ）
Write-Host "Electronオーバーレイ起動中..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", "npm run overlay:dev" `
    -WorkingDirectory $PSScriptRoot

Write-Host ""
Write-Host "=== 起動完了 ===" -ForegroundColor Cyan
Write-Host "ブラウザ: http://localhost:5173" -ForegroundColor White
Write-Host "ログイン: aulait11.17@gmail.com / Masa1515" -ForegroundColor White
Write-Host ""
Write-Host "終了するには各ウィンドウを閉じてください" -ForegroundColor Yellow
