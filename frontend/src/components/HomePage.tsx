import { useAuth } from '../hooks/useAuth'

interface Props {
  onStart: () => void
  onPricing: () => void
  onLogin: () => void
}

export default function HomePage({ onStart, onPricing, onLogin }: Props) {
  const { user } = useAuth()

  return (
    <div className="home-page">
      <div className="home-inner">
        {/* ロゴ */}
        <div className="home-logo">InterviewAI</div>

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
      </div>
    </div>
  )
}
