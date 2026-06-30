# 本番環境 疎通確認スクリプト
# 使い方: powershell -File scripts/verify-production.ps1

$BASE_URL = "https://interview-assistant-hrar.onrender.com"
$PASS = 0
$FAIL = 0

function Check($label, $url, $expect) {
    try {
        $res = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 15
        $body = $res | ConvertTo-Json -Compress 2>$null
        if ($body -like "*$expect*") {
            Write-Host "  [OK] $label" -ForegroundColor Green
            $script:PASS++
        } else {
            Write-Host "  [NG] $label - 期待値:$expect 実際:$body" -ForegroundColor Red
            $script:FAIL++
        }
    } catch {
        Write-Host "  [NG] $label - エラー: $_" -ForegroundColor Red
        $script:FAIL++
    }
}

function CheckPost($label, $url, $body, $expect) {
    try {
        $res = Invoke-RestMethod -Uri $url -Method POST -Body ($body | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 15
        $resBody = $res | ConvertTo-Json -Compress 2>$null
        if ($resBody -like "*$expect*") {
            Write-Host "  [OK] $label" -ForegroundColor Green
            $script:PASS++
        } else {
            Write-Host "  [NG] $label - 期待値:$expect 実際:$resBody" -ForegroundColor Red
            $script:FAIL++
        }
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        # 401/403は認証エラーなので「エンドポイントは生きている」と判定
        if ($status -eq 401 -or $status -eq 403 -or $status -eq 422) {
            Write-Host "  [OK] $label (認証エラー=$status は正常)" -ForegroundColor Green
            $script:PASS++
        } else {
            Write-Host "  [NG] $label - HTTP $status" -ForegroundColor Red
            $script:FAIL++
        }
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  面接アシスタント 本番環境 疎通確認" -ForegroundColor Cyan
Write-Host "  対象: $BASE_URL" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "【基本】" -ForegroundColor Yellow
Check "ヘルスチェック"    "$BASE_URL/health"   "ok"
Check "ルート"           "$BASE_URL/"         "Interview Assistant"

Write-Host ""
Write-Host "【認証】" -ForegroundColor Yellow
CheckPost "ログインエンドポイント" "$BASE_URL/api/auth/login" @{email="test@test.com"; password="wrong"} ""

Write-Host ""
Write-Host "【決済】" -ForegroundColor Yellow
CheckPost "プラン一覧（認証必要）"  "$BASE_URL/api/billing/plans" @{} ""
Check     "プロバイダー一覧"        "$BASE_URL/api/billing/providers" "stripe"

Write-Host ""
Write-Host "【AI・音声】" -ForegroundColor Yellow
CheckPost "文字起こし（認証必要）" "$BASE_URL/api/speech/transcribe" @{} ""
CheckPost "ヒント生成（認証必要）" "$BASE_URL/api/interview/hint-stream" @{} ""

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  結果: OK=$PASS  NG=$FAIL" -ForegroundColor $(if ($FAIL -eq 0) { "Green" } else { "Red" })
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

if ($FAIL -gt 0) {
    Write-Host "NGがあります。Renderのログを確認してください:" -ForegroundColor Red
    Write-Host "  https://dashboard.render.com → interview-assistant-backend → Logs" -ForegroundColor Red
}
