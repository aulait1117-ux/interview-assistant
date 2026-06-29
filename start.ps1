# 面接アシスタント 起動スクリプト

Write-Host "=== 面接アシスタント起動 ===" -ForegroundColor Cyan

# .env チェック
if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Host "[ERROR] .env ファイルが見つかりません。.env.example をコピーして設定してください。" -ForegroundColor Red
    exit 1
}

# フロントエンド起動
Write-Host "フロントエンド起動中..." -ForegroundColor Green
$frontend = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$PSScriptRoot\frontend" -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 3
Write-Host "フロントエンド起動完了 → http://localhost:5173" -ForegroundColor Green

# バックエンド自動再起動ループ
Write-Host "バックエンド起動中（クラッシュ時自動再起動）..." -ForegroundColor Green
Write-Host "終了するには Ctrl+C を押してください" -ForegroundColor Yellow
Write-Host ""

$backendDir = "$PSScriptRoot\backend"
$restartCount = 0

try {
    while ($true) {
        if ($restartCount -gt 0) {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] バックエンド再起動中... (${restartCount}回目)" -ForegroundColor Yellow
            Start-Sleep -Seconds 2
        }

        $backend = Start-Process -FilePath "py" `
            -ArgumentList "-m", "uvicorn", "main:app", "--port", "8000" `
            -WorkingDirectory $backendDir -PassThru -WindowStyle Hidden

        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] バックエンド起動 (PID: $($backend.Id))" -ForegroundColor Green

        $backend.WaitForExit()
        $restartCount++
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] バックエンドが停止しました (終了コード: $($backend.ExitCode))" -ForegroundColor Red
    }
} finally {
    Write-Host "シャットダウン中..." -ForegroundColor Cyan
    Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
    Get-Process -Name "python*" -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "終了しました" -ForegroundColor Cyan
}
