/**
 * DesktopGuide.tsx
 * 「インストール版でできること」説明ページ。
 * ブラウザ版とインストール版の違いを、初見ユーザーでも理解できるように説明する。
 */

interface Props {
  onBack?: (e: React.MouseEvent) => void
}

const COMPARE_ROWS: { label: string; browser: string; desktop: string }[] = [
  { label: 'インストール', browser: '不要', desktop: '必要' },
  { label: '使い始めやすさ', browser: '高い', desktop: 'やや準備が必要' },
  { label: 'ヒント表示', browser: 'ページ内に表示', desktop: '透明パネルで表示' },
  { label: 'Zoom上に重ねる', browser: '不可', desktop: '可能' },
  { label: '面接練習', browser: '可能', desktop: '可能' },
  { label: '本格利用', browser: '普通', desktop: '高い' },
  { label: '初心者向け', browser: 'とても向いている', desktop: '説明が必要' },
]

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: '48px 0 16px' }}>{children}</h2>
}

// インストーラの配布先（GitHub Releasesの「最新版」固定URL。バージョンを上げても同じ資産名で
// 再アップすればこのURLは変わらない）。VITE_DESKTOP_DOWNLOAD_URL で差し替え可能。
const DOWNLOAD_URL =
  (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ||
  'https://github.com/aulait1117-ux/interview-assistant/releases/latest/download/interview-assistant-setup-windows-x64.exe'

type OSKind = 'windows' | 'mac' | 'other'

function detectOS(): OSKind {
  if (typeof navigator === 'undefined') return 'other'
  const ua = (navigator.userAgent || '').toLowerCase()
  const platform = ((navigator as any).platform || '').toLowerCase()
  if (ua.includes('windows') || platform.includes('win')) return 'windows'
  // iPad/iPhone等のモバイルはmac扱いにしないよう先に除外
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('android')) return 'other'
  if (ua.includes('mac') || platform.includes('mac')) return 'mac'
  return 'other'
}

// ダウンロード導線（Windowsのみ実ダウンロード、それ以外は案内）。onTryBrowser=ブラウザ版に戻る導線
function DownloadCTA({ onTryBrowser }: { onTryBrowser?: (e: React.MouseEvent) => void }) {
  const os = detectOS()

  if (os !== 'windows') {
    return (
      <div style={{
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: 14, padding: 20, margin: '24px 0',
      }}>
        <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#a5b4fc' }}>
          インストール版は現在 Windows のみ対応です
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#cbd5e1', lineHeight: 1.8 }}>
          お使いの端末（Mac / スマートフォン等）ではインストール不要の<strong>ブラウザ版</strong>をご利用ください。
          面接練習・リアルタイムのヒント表示はブラウザ版でも使えます。
        </p>
        <a href="/" onClick={onTryBrowser} style={{
          display: 'inline-block', padding: '12px 24px', borderRadius: 10,
          background: 'rgba(99,102,241,0.85)', color: '#fff', fontWeight: 700, fontSize: 14,
          textDecoration: 'none', whiteSpace: 'nowrap',
        }}>
          ブラウザ版を試す →
        </a>
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.35)',
      borderRadius: 14, padding: 24, margin: '24px 0', textAlign: 'center',
    }}>
      <a href={DOWNLOAD_URL} download style={{
        display: 'inline-block', padding: '16px 40px', borderRadius: 12,
        background: '#22c55e', color: '#04140a', fontWeight: 900, fontSize: 17,
        textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 6px 20px rgba(34,197,94,0.25)',
      }}>
        ⬇ Windows版をダウンロード（無料）
      </a>
      <p style={{ margin: '12px 0 0', fontSize: 12, color: '#86efac' }}>
        Windows 10 / 11（64bit）対応・約80MB
      </p>
      <div style={{
        marginTop: 16, padding: 12, background: 'rgba(234,179,8,0.08)',
        border: '1px solid rgba(234,179,8,0.3)', borderRadius: 10, textAlign: 'left',
      }}>
        <p style={{ margin: 0, fontSize: 12.5, color: '#fde68a', lineHeight: 1.9 }}>
          ⚠️ インストール時に「WindowsによってPCが保護されました」という青い警告が出ることがあります。
          これは発行元未登録のアプリで表示される標準の確認です。
          <strong>「詳細情報」→「実行」</strong>の順に押すとインストールできます。
        </p>
      </div>
    </div>
  )
}

export default function DesktopGuide({ onBack }: Props) {
  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 20px', background: 'rgba(15,23,42,0.95)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <a href="/" style={{ color: '#94a3b8', fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap' }} onClick={onBack}>← トップに戻る</a>
        <span style={{ fontWeight: 700, fontSize: 15 }}>面接アシスタント</span>
      </header>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 20px 80px' }}>
        <h1 style={{ fontSize: 30, fontWeight: 900, margin: '0 0 8px' }}>インストール版でできること</h1>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.8 }}>
          面接アシスタントには「ブラウザ版」と「インストール版（デスクトップアプリ）」の2種類があります。
          どちらを使えばいいか迷ったら、このページで違いを確認してください。
        </p>

        {/* ダウンロードCTA（Windowsのみ実DL・それ以外はブラウザ版へ案内） */}
        <DownloadCTA onTryBrowser={onBack} />
        <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.8, margin: '4px 0 0' }}>
          まずは<strong>インストール不要のブラウザ版</strong>で試して、Zoomの上にヒントを重ねたくなったら
          インストール版へ——という順番がおすすめです。
        </p>

        {/* 1. ブラウザ版との違い（比較表） */}
        <SectionTitle>1. ブラウザ版との違い</SectionTitle>
        <div className="guide-table-wrap">
          <table className="guide-compare-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>ブラウザ版</th>
                <th>インストール版</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(row => (
                <tr key={row.label}>
                  <td className="guide-compare-label">{row.label}</td>
                  <td>{row.browser}</td>
                  <td>{row.desktop}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 2. ブラウザ版はこんな人向け / 3. インストール版はこんな人向け */}
        <div className="guide-two-col">
          <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 17, color: '#a5b4fc' }}>2. ブラウザ版はこんな人向け</h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#cbd5e1', fontSize: 14, lineHeight: 2 }}>
              <li>まず試したい人</li>
              <li>面接練習をしたい人</li>
              <li>インストールしたくない人</li>
            </ul>
          </div>
          <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 17, color: '#86efac' }}>3. インストール版はこんな人向け</h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#cbd5e1', fontSize: 14, lineHeight: 2 }}>
              <li>PC上で本格的に練習したい人</li>
              <li>Zoom画面を見ながらヒントを確認したい人</li>
              <li>透明パネルを使いたい人</li>
            </ul>
          </div>
        </div>

        {/* 4. インストールするとどうなるか（画像付き） */}
        <SectionTitle>4. インストールするとどうなるか</SectionTitle>
        <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8 }}>
          ブラウザ版はページの中にヒントが表示されるのに対し、インストール版はZoomなど他のアプリの上に
          透明なパネルを浮かせて表示できます。面接本番の画面を見ながら、視線を大きく動かさずにヒントを確認できます。
        </p>
        <div className="guide-image-grid">
          <figure style={{ margin: 0 }}>
            <img src="/images/browser-mode.png" alt="ブラウザ版の画面イメージ：録音スイッチ・回答モード切替・質問の文字起こし・回答ヒントがページ内に表示されている" style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} />
            <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>ブラウザ版：ヒントはページ内に自動表示</figcaption>
          </figure>
          <figure style={{ margin: 0 }}>
            <img src="/images/desktop-overlay.png" alt="インストール版の画面イメージ：Zoom画面の上に透明なヒントパネルが浮いている" style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} />
            <figcaption style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>インストール版：Zoom等の上に透明パネルが浮く</figcaption>
          </figure>
        </div>

        {/* 5. 使い方の流れ */}
        <SectionTitle>5. 使い方の流れ</SectionTitle>
        <img src="/images/install-steps.png" alt="インストール版の使い方の流れ：①ダウンロード②インストール③起動④マイク許可⑤透明パネル表示" style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)' }} />
        <ol style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 2.2, marginTop: 16 }}>
          <li>アプリをダウンロード</li>
          <li>インストール（Windowsの警告が出た場合は「詳細情報」→「実行」）</li>
          <li>起動</li>
          <li>マイク許可（初回のみ）</li>
          <li>面接練習開始</li>
          <li>透明パネルでヒント確認</li>
        </ol>

        {/* 6. 注意点 */}
        <SectionTitle>6. 注意点</SectionTitle>
        <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 12, padding: 20 }}>
          <p style={{ margin: '0 0 10px', fontSize: 14, color: '#fde68a', fontWeight: 700 }}>
            このアプリは面接練習・準備支援を目的としたツールです。
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#fde68a', fontSize: 13, lineHeight: 2 }}>
            <li>実際の面接や第三者との会話を録音・使用する場合は、相手の同意や利用規約を確認してください。</li>
            <li>面接官や企業に対して、AIの支援を受けていることを偽ったり、不正な手段として利用しないでください。</li>
            <li>PC環境（OS・マイク・ネットワーク）によって動作が異なる場合があります。</li>
            <li>初回起動時にマイク権限などの許可が必要になる場合があります。</li>
          </ul>
        </div>

        {/* 7. ダウンロード（ページ下部にも再掲） */}
        <SectionTitle>7. ダウンロード</SectionTitle>
        <DownloadCTA onTryBrowser={onBack} />

        <div style={{ marginTop: 32, textAlign: 'center' }}>
          <a href="/" onClick={onBack} style={{
            display: 'inline-block', padding: '14px 32px', borderRadius: 12,
            background: 'rgba(99,102,241,0.85)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}>
            トップに戻ってブラウザ版を試す →
          </a>
        </div>
      </div>
    </div>
  )
}
