import { useAuth } from '../hooks/useAuth'

interface Props {
  onStart: () => void
  onPricing: () => void
  onLogin: () => void
  onNavigateGuide?: (e: React.MouseEvent) => void
}

export default function HomePage({ onStart, onPricing, onLogin, onNavigateGuide }: Props) {
  const { user } = useAuth()

  return (
    <div className="home-page">
      <div className="home-inner">
        {/* ロゴ */}
        <div className="home-logo">
          <img className="brand-mark" src="/favicon.svg" alt="企業道" />
          <span className="home-logo-text">InterviewAI</span>
        </div>

        {/* キャッチコピー */}
        <h1 className="home-catchcopy">面接の不安を、自信に変える。</h1>
        <p className="home-sub">
          AIがリアルタイムでサポート。練習から本番まで、あなたの面接を徹底サポートします。
        </p>

        {/* スタートボタン */}
        <div className="home-actions">
          {user ? (
            <button className="btn-home-start" onClick={onStart}>
              始める →
            </button>
          ) : (
            <button className="btn-home-start" onClick={onLogin}>
              ログインして始める →
            </button>
          )}
          <button className="btn-home-pricing" onClick={onPricing}>
            料金プランを見る
          </button>
        </div>

        {/* 特徴 */}
        <div className="home-features">
          <div className="home-feature-item">
            <span className="home-feature-icon">🎤</span>
            <span className="home-feature-text">リアルタイム面接補助</span>
          </div>
          <div className="home-feature-item">
            <span className="home-feature-icon">🤖</span>
            <span className="home-feature-text">AI評価フィードバック</span>
          </div>
          <div className="home-feature-item">
            <span className="home-feature-icon">🏢</span>
            <span className="home-feature-text">企業情報自動リサーチ</span>
          </div>
        </div>

        {/* インストール版との違いへの導線 */}
        <p style={{ marginTop: 28, fontSize: 13, color: '#94a3b8', lineHeight: 1.8 }}>
          ブラウザ版はインストール不要ですぐ試せます。<br />
          Zoom画面の上にヒントを浮かせたい場合は{' '}
          <a href="/desktop-guide" onClick={onNavigateGuide} style={{ color: '#818cf8', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            インストール版でできること
          </a>{' '}
          をご覧ください。
        </p>
      </div>
    </div>
  )
}
