# バックエンド自動再起動スクリプト
# クラッシュしても即座に再起動する。本番使用時はこれを使う。

$BackendDir = Split-Path $PSScriptRoot -Parent | Join-Path -ChildPath "backend"
$MaxRestarts = 50
$RestartCount = 0

Write-Host "[launcher] バックエンド起動スクリプト開始"
Write-Host "[launcher] BackendDir: $BackendDir"

# 既存のpython/pyプロセスでポート8000を使っているものを終了
$existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[launcher] 既存のポート8000プロセスを停止..."
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

while ($RestartCount -lt $MaxRestarts) {
    $RestartCount++
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host ""
    Write-Host "[$timestamp] バックエンド起動 (試行 $RestartCount/$MaxRestarts)..."

    # --reload なしで起動（プロセスが1つになりkillが確実になる）
    $proc = Start-Process -FilePath "py" `
        -ArgumentList "-m", "uvicorn", "main:app", "--port", "8000", "--host", "0.0.0.0" `
        -WorkingDirectory $BackendDir `
        -PassThru -NoNewWindow

    Write-Host "[launcher] PID: $($proc.Id) で起動"
    $proc.WaitForExit()

    $exitCode = $proc.ExitCode
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] バックエンド終了 (ExitCode: $exitCode)"

    if ($RestartCount -ge $MaxRestarts) {
        Write-Host "[launcher] 最大再起動回数に達しました。終了します。"
        break
    }

    Write-Host "[launcher] 3秒後に再起動..."
    Start-Sleep -Seconds 3
}
