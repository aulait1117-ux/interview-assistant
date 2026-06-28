import { useState, useCallback, useEffect } from 'react'
import { InterviewType, HintResponse } from '../types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import FeedbackPanel from './FeedbackPanel'
import { useAuth } from '../hooks/useAuth'
import OverlayButton, { sendHintToOverlay } from './OverlayButton'


interface Props {
  sessionId: string
  interviewType: InterviewType
  userBackground: string
  onBack: () => void
  onShowPricing?: () => void
}

interface QARecord {
  question: string
  hints: HintResponse
  userAnswer: string
  timestamp: number
}

export default function RealtimeMode({ sessionId, interviewType, userBackground, onBack, onShowPricing }: Props) {
  const { user } = useAuth()
  const [currentHints, setCurrentHints] = useState<HintResponse | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [qaHistory, setQaHistory] = useState<QARecord[]>([])
  const [userAnswer, setUserAnswer] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [manualQuestion, setManualQuestion] = useState('')
  const [timeExpired, setTimeExpired] = useState(false)

  // 機能3: ストリーミング用 state
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingAnswer, setStreamingAnswer] = useState('')

  // --- オーバーレイ同期 (Electron IPC + ブラウザ BroadcastChannel) ---
  // ストリーミング中・完了後にオーバーレイウィンドウへヒントを送信する
  useEffect(() => {
    const payload = {
      question: currentQuestion,
      answer: currentHints?.answer ?? '',
      isStreaming,
      streamingText: streamingAnswer,
    }

    // Electron IPC 経由で送信
    const api = window.electronAPI
    if (api?.sendHintsToOverlay) {
      api.sendHintsToOverlay(payload)
    }

    // ブラウザ BroadcastChannel 経由でも常に送信（オーバーレイページが開いていれば届く）
    sendHintToOverlay(payload)
  }, [currentQuestion, currentHints, isStreaming, streamingAnswer])

  // 戻るボタン
  const handleBack = useCallback(() => {
    onBack()
  }, [onBack])

  // 機能3: ストリーミングで質問を処理
  const handleQuestionDetected = useCallback(async (question: string) => {
    setCurrentQuestion(question)
    setCurrentHints(null)
    setStreamingAnswer('')
    setIsStreaming(true)
    setIsLoading(false)
    setUserAnswer('')

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/interview/hint-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          question,
          interview_type: interviewType,
          user_background: userBackground || null,
        }),
      })

      if (res.status === 403) {
        setTimeExpired(true)
        setIsStreaming(false)
        return
      }

      if (!res.ok || !res.body) {
        console.error('Stream request failed:', res.status)
        setIsStreaming(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        // SSE フォーマット: "data: {text}\n\n"
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6)
            if (text === '[DONE]') continue
            accumulated += text
            setStreamingAnswer(accumulated)
          }
        }
      }

      // ストリーミング完了後に最終結果をセット
      setCurrentHints({ answer: accumulated })
      setIsStreaming(false)
    } catch (e: any) {
      console.error(e)
      setIsStreaming(false)
    }
  }, [sessionId, interviewType, userBackground])

  const { isListening, transcript, startListening, stopListening } =
    useSpeechRecognition(interviewType, handleQuestionDetected)

  // 残り時間が0になったら自動停止（管理者はスキップ）
  useEffect(() => {
    if (user && !user.is_admin && user.minutes_left === 0) {
      stopListening()
      setTimeExpired(true)
    }
  }, [user?.minutes_left, user?.is_admin, stopListening])

  // 機能2: ショートカットキー
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'Space' || e.key.toLowerCase() === 'r') {
        e.preventDefault()
        if (isListening) {
          stopListening()
        } else {
          startListening()
        }
      } else if (e.key === 'Escape') {
        handleBack()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isListening, startListening, stopListening, handleBack])

  const saveCurrentAnswer = () => {
    if (!currentQuestion || !currentHints) return
    setQaHistory(prev => [...prev, {
      question: currentQuestion,
      hints: currentHints,
      userAnswer,
      timestamp: Date.now(),
    }])
    setCurrentQuestion('')
    setCurrentHints(null)
    setUserAnswer('')
  }

  const handleManualSubmit = () => {
    if (!manualQuestion.trim()) return
    handleQuestionDetected(manualQuestion.trim())
    setManualQuestion('')
  }

  if (showFeedback) {
    return <FeedbackPanel sessionId={sessionId} onBack={handleBack} />
  }

  if (timeExpired) {
    return (
      <div className="realtime-mode">
        <header className="mode-header">
          <button className="back-btn" onClick={handleBack}>← 戻る</button>
        </header>
        <div className="time-expired-screen">
          <div className="time-expired-icon">⏰</div>
          <h2 className="time-expired-title">利用時間が終了しました</h2>
          <p className="time-expired-message">
            無料プランの30分間をすべて使い切りました。<br />
            引き続きご利用いただくには、プランをアップグレードしてください。
          </p>
          <div className="time-expired-actions">
            <button
              className="btn-upgrade"
              onClick={() => onShowPricing?.()}
            >
              プランをアップグレード →
            </button>
            <button className="back-btn-secondary" onClick={handleBack}>
              ホームに戻る
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="realtime-mode">
      <header className="mode-header">
        <button className="back-btn" onClick={handleBack}>← 戻る</button>
        <div className="mode-info">
          <span className="mode-badge realtime">リアルタイム</span>
          <span className="interview-type">{interviewType}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* オーバーレイボタン: Electron/ブラウザ両対応 */}
          <OverlayButton />
          <button
            className="feedback-btn"
            onClick={() => { stopListening(); setShowFeedback(true) }}
            disabled={qaHistory.length === 0}
          >
            セッション終了・総評
          </button>
        </div>
      </header>

      <div className="realtime-layout">
        <div className="voice-panel">
          <div className="voice-controls">
            <button
              className={`mic-btn ${isListening ? 'active' : ''}`}
              onClick={isListening ? stopListening : startListening}
            >
              <span className="mic-icon">{isListening ? '⏹' : '🎙️'}</span>
              <span>{isListening ? '録音停止' : 'マイク開始'}</span>
            </button>
            {isListening && (
              <div className="listening-indicator">
                <span className="pulse" />
                聞き取り中...
              </div>
            )}
          </div>

          {transcript && (
            <div className="transcript-box">
              <p className="transcript-label">認識中</p>
              <p className="transcript-text">{transcript}</p>
            </div>
          )}

          <div className="manual-input">
            <p className="section-label">手動で質問を入力</p>
            <div className="manual-row">
              <input
                type="text"
                placeholder="質問を直接入力..."
                value={manualQuestion}
                onChange={(e) => setManualQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              />
              <button onClick={handleManualSubmit} disabled={!manualQuestion.trim()}>
                送信
              </button>
            </div>
          </div>
        </div>

        {/* メインエリア */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {!isStreaming && !currentHints && !isLoading && (
            <div className="empty-hints" style={{ height: '100%' }}>
              <div className="empty-icon">🎯</div>
              <p>面接官の質問を話しかけてください</p>
              <p className="empty-sub">音声を自動認識してヒントを表示します</p>
            </div>
          )}
        </div>

        {qaHistory.length > 0 && (
          <div className="qa-history">
            <h3>このセッションの記録 ({qaHistory.length}問)</h3>
            <div className="history-list">
              {qaHistory.map((qa, i) => (
                <div key={qa.timestamp} className="history-item">
                  <p className="history-q">Q{i + 1}: {qa.question.slice(0, 60)}...</p>
                  {qa.userAnswer && <p className="history-a">メモ: {qa.userAnswer.slice(0, 80)}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
