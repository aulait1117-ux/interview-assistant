import { useState, useCallback, useEffect, useRef } from 'react'
import { InterviewType, HintResponse } from '../types'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import FeedbackPanel from './FeedbackPanel'
import { useAuth } from '../hooks/useAuth'


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

interface PanelPos {
  x: number
  y: number
}

interface PanelSize {
  width: number
  height: number
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

  // 機能1: フローティングパネル用 state
  const [panelPos, setPanelPos] = useState<PanelPos>(() => {
    try {
      const saved = localStorage.getItem('hints-panel-pos')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { x: window.innerWidth - 420, y: 80 }
  })
  const [panelSize, setPanelSize] = useState<PanelSize>(() => {
    try {
      const saved = localStorage.getItem('hints-panel-size')
      if (saved) return JSON.parse(saved)
    } catch {}
    return { width: 380, height: 480 }
  })
  const [panelOpacity, setPanelOpacity] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('hints-panel-opacity')
      if (saved) return parseFloat(saved)
    } catch {}
    return 0.85
  })
  const [isPanelMinimized, setIsPanelMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem('hints-panel-minimized') === 'true'
    } catch {}
    return false
  })

  // ドラッグ追跡 ref
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 })
  // リサイズ追跡 ref
  const isResizingRef = useRef(false)
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 380, height: 480 })

  // パネル位置を localStorage に保存
  useEffect(() => {
    localStorage.setItem('hints-panel-pos', JSON.stringify(panelPos))
  }, [panelPos])

  // パネルサイズを localStorage に保存
  useEffect(() => {
    localStorage.setItem('hints-panel-size', JSON.stringify(panelSize))
  }, [panelSize])

  // パネル透明度を localStorage に保存
  useEffect(() => {
    localStorage.setItem('hints-panel-opacity', String(panelOpacity))
  }, [panelOpacity])

  // パネル最小化状態を localStorage に保存
  useEffect(() => {
    localStorage.setItem('hints-panel-minimized', String(isPanelMinimized))
  }, [isPanelMinimized])

  // --- Electron オーバーレイ同期 ---
  // ストリーミング中・完了後にオーバーレイウィンドウへヒントを送信する
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.sendHintsToOverlay) return
    api.sendHintsToOverlay({
      question: currentQuestion,
      answer: currentHints?.answer ?? '',
      isStreaming,
      streamingText: streamingAnswer,
    })
  }, [currentQuestion, currentHints, isStreaming, streamingAnswer])

  // ドラッグ開始
  const handlePanelMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: panelPos.x,
      panelY: panelPos.y,
    }
    e.preventDefault()
  }, [panelPos])

  // リサイズ開始
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    }
    e.preventDefault()
    e.stopPropagation()
  }, [panelSize])

  // グローバル mousemove / mouseup
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.mouseX
        const dy = e.clientY - dragStartRef.current.mouseY
        setPanelPos({
          x: dragStartRef.current.panelX + dx,
          y: dragStartRef.current.panelY + dy,
        })
      } else if (isResizingRef.current) {
        const dx = e.clientX - resizeStartRef.current.mouseX
        const dy = e.clientY - resizeStartRef.current.mouseY
        setPanelSize({
          width: Math.max(280, resizeStartRef.current.width + dx),
          height: Math.max(200, resizeStartRef.current.height + dy),
        })
      }
    }
    const onMouseUp = () => {
      isDraggingRef.current = false
      isResizingRef.current = false
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

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

  // ストリーミング中または完了後のヒント表示判定
  const showHints = (isStreaming || currentHints !== null) && currentQuestion

  return (
    <div className="realtime-mode">
      <header className="mode-header">
        <button className="back-btn" onClick={handleBack}>← 戻る</button>
        <div className="mode-info">
          <span className="mode-badge realtime">リアルタイム</span>
          <span className="interview-type">{interviewType}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Electron環境のときのみオーバーレイトグルボタンを表示 */}
          {window.electronAPI?.isElectron && (
            <button
              className="feedback-btn"
              style={{ fontSize: 12 }}
              onClick={() => window.electronAPI?.toggleOverlay()}
              title="Zoomなどの上に表示されるヒントオーバーレイを表示/非表示"
            >
              💡 オーバーレイ
            </button>
          )}
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

        {/* メインエリア（パネルのプレースホルダー兼空エリア） */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          {!showHints && !isLoading && (
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

      {/* 機能1: フローティングヒントパネル（透過オーバーレイ） */}
      <div
        className="hints-panel-floating"
        style={{
          left: panelPos.x,
          top: panelPos.y,
          width: panelSize.width,
          height: isPanelMinimized ? 'auto' : panelSize.height,
          '--panel-opacity': panelOpacity,
        } as React.CSSProperties}
      >
        <div
          className="hints-panel-header"
          onMouseDown={handlePanelMouseDown}
        >
          <span className="hints-panel-title">💡 ヒントパネル</span>
          <div className="hints-panel-header-controls" onMouseDown={(e) => e.stopPropagation()}>
            <label className="opacity-control-inline">
              <span className="opacity-label-inline">透明度</span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={panelOpacity}
                onChange={(e) => setPanelOpacity(parseFloat(e.target.value))}
                className="opacity-slider-inline"
              />
            </label>
            <button
              className="hints-panel-minimize-btn"
              onClick={() => setIsPanelMinimized(v => !v)}
            >
              {isPanelMinimized ? '▲' : '▼'}
            </button>
          </div>
        </div>

        <div className={`hints-panel-body${isPanelMinimized ? ' minimized' : ''}`}>
          {isLoading && (
            <div className="loading-state">
              <div className="spinner" />
              <p>回答を生成中...</p>
            </div>
          )}

          {(isStreaming || currentHints) && currentQuestion && (
            <div className="hints-content">
              <div className="detected-question">
                <p className="question-label">検出された質問</p>
                <p className="question-text">{currentQuestion}</p>
              </div>

              <div className="answer-main">
                <h3>模範回答</h3>
                <div className="answer-full-text">
                  {isStreaming ? streamingAnswer : currentHints?.answer}
                  {isStreaming && <span className="streaming-cursor" />}
                </div>
              </div>

              {!isStreaming && currentHints && (
                <div className="answer-record">
                  <button className="save-btn" onClick={saveCurrentAnswer}>
                    記録して次へ
                  </button>
                </div>
              )}
            </div>
          )}

          {!isLoading && !isStreaming && !currentHints && (
            <div className="empty-hints">
              <div className="empty-icon">🎯</div>
              <p>面接官の質問を話しかけてください</p>
              <p className="empty-sub">音声を自動認識してヒントを表示します</p>
            </div>
          )}
        </div>

        {/* リサイズハンドル（右下） */}
        {!isPanelMinimized && (
          <div
            className="hints-panel-resize-handle"
            onMouseDown={handleResizeMouseDown}
          />
        )}
      </div>
    </div>
  )
}
