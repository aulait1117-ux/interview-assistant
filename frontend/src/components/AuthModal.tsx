import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  onClose: () => void
}

export default function AuthModal({ onClose }: Props) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.detail || 'エラーが発生しました')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError('') }}
          >
            ログイン
          </button>
          <button
            className={`modal-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError('') }}
          >
            新規登録
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-field">
            <label>メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
            />
          </div>
          <div className="form-field">
            <label>パスワード{mode === 'register' && '（6文字以上）'}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="btn-auth-submit" type="submit" disabled={isLoading}>
            {isLoading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </form>

        {mode === 'login' && (
          <p className="auth-switch">
            アカウントをお持ちでない方は
            <button onClick={() => setMode('register')}>新規登録</button>
          </p>
        )}
      </div>
    </div>
  )
}
