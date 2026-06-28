import { useState, useEffect } from 'react'
import axios from 'axios'
import { SessionFeedback } from '../types'

interface Props {
  sessionId: string
  onBack: () => void
}

export default function FeedbackPanel({ sessionId, onBack }: Props) {
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    axios.post<SessionFeedback>('/api/feedback/session', { session_id: sessionId })
      .then(r => setFeedback(r.data))
      .catch(() => setError('フィードバックの取得に失敗しました。質問に回答してから試してください。'))
      .finally(() => setIsLoading(false))
  }, [sessionId])

  const scoreColor = (score: number) =>
    score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'

  if (isLoading) {
    return (
      <div className="feedback-loading">
        <div className="spinner large" />
        <p>セッション全体を分析中...</p>
        <p className="loading-sub">少々お待ちください</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="feedback-error">
        <p>{error}</p>
        <button onClick={onBack}>戻る</button>
      </div>
    )
  }

  if (!feedback) return null

  return (
    <div className="feedback-panel">
      <header className="feedback-header">
        <button className="back-btn" onClick={onBack}>← ホームに戻る</button>
        <h1>セッション総評</h1>
      </header>

      <div className="feedback-content">
        <div className="overall-score">
          <div
            className="big-score"
            style={{ color: scoreColor(feedback.overall_score) }}
          >
            {feedback.overall_score}
            <span className="big-score-unit">点</span>
          </div>
          <p className="summary-text">{feedback.summary}</p>
        </div>

        <div className="feedback-grid">
          <div className="feedback-card strengths">
            <h2>強み</h2>
            <ul>
              {feedback.strengths.map((s, i) => (
                <li key={i}>
                  <span className="bullet good">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>

          <div className="feedback-card improvements">
            <h2>改善ポイント</h2>
            <ul>
              {feedback.improvements.map((s, i) => (
                <li key={i}>
                  <span className="bullet warn">!</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="feedback-card action-items">
          <h2>次の面接までにやること</h2>
          <ol>
            {feedback.action_items.map((a, i) => (
              <li key={i}>
                <span className="action-num">{i + 1}</span>
                <span>{a}</span>
              </li>
            ))}
          </ol>
        </div>

        <button className="btn-home" onClick={onBack}>
          別の面接を練習する
        </button>
      </div>
    </div>
  )
}
