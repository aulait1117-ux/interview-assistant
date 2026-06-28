import { useAuth } from '../hooks/useAuth'

interface Props {
  onLogin: () => void
  onPricing: () => void
  onHome?: () => void
}

export default function AppHeader({ onLogin, onPricing, onHome }: Props) {
  const { user, logout } = useAuth()

  const minutesPercent = user
    ? Math.max(0, Math.min(100, (user.minutes_left / user.minutes_limit) * 100))
    : 100

  const meterColor = minutesPercent > 50 ? '#22c55e' : minutesPercent > 20 ? '#f59e0b' : '#ef4444'

  return (
    <header className="app-header">
      <div
        className="app-logo"
        onClick={onHome}
        style={{ cursor: onHome ? 'pointer' : 'default' }}
        title="ホームに戻る"
      >
        面接アシスタント
      </div>

      <div className="header-right">
        {user && (
          <div className="usage-meter">
            <span className="usage-plan">{user.plan_name}</span>
            <div className="usage-bar">
              <div
                className="usage-fill"
                style={{ width: `${minutesPercent}%`, background: meterColor }}
              />
            </div>
            <span className="usage-text">
              {user.minutes_left >= 60
                ? `残り${Math.floor(user.minutes_left / 60)}時間${user.minutes_left % 60}分`
                : `残り${user.minutes_left}分`}
            </span>
          </div>
        )}

        <button className="header-btn pricing-btn" onClick={onPricing}>
          料金プラン
        </button>

        {user ? (
          <div className="user-menu">
            <span className="user-email">{user.email}</span>
            <button className="header-btn logout-btn" onClick={logout}>
              ログアウト
            </button>
          </div>
        ) : (
          <button className="header-btn login-btn" onClick={onLogin}>
            ログイン / 登録
          </button>
        )}
      </div>
    </header>
  )
}
