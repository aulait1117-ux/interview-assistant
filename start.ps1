# 面接アシスタント 起動スクリプト

Write-Host "=== 面接アシスタント起動 ===" -ForegroundColor Cyan

# .env チェック
if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Host "[ERROR] .env ファイルが見つかりません。.env.example をコピーして設定してください。" -ForegroundColor Red
    exit 1
}

# バックエンド起動
Write-Host "バックエンド起動中..." -ForegroundColor Green
$backend = Start-Process -FilePath "py" -ArgumentList "-m", "uvicorn", "backend.main:app", "--reload", "--port", "8000" `
    -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow

Start-Sleep -Seconds 2

# フロントエンド起動
Write-Host "フロントエンド起動中..." -ForegroundColor Green
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" `
    -WorkingDirectory "$PSScriptRoot\frontend" -PassThru -NoNewWindow

Write-Host ""
Write-Host "起動完了！ブラウザで http://localhost:5173 を開いてください" -ForegroundColor Cyan
Write-Host "終了するには Ctrl+C を押してください"

try {
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
}
