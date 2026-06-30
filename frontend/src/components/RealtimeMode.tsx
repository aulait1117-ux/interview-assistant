import { useState, useCallback, useEffect, useRef } from 'react'
import { InterviewType, HintResponse } from '../types'
import FeedbackPanel from './FeedbackPanel'
import { useAuth } from '../hooks/useAuth'
import { sendHintToOverlay } from './OverlayButton'


interface Props {
  sessionId: string
  interviewType: InterviewType
  userBackground: string
  jobTitle?: string
  interviewTypePref?: string
  onBack: () => void
  onShowPricing?: () => void
}

interface QARecord {
  question: string
  hints: HintResponse
  userAnswer: string
  timestamp: number
}

export default function RealtimeMode({ sessionId, interviewType, userBackground, jobTitle, interviewTypePref, onBack, onShowPricing }: Props) {
  const { user, token } = useAuth()
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

  // インラインヒントポップアップ
  const [showHintPopup, setShowHintPopup] = useState(false)
  const [popupPos, setPopupPos] = useState<{ x: number; y: number }>(() => {
    try { return JSON.parse(localStorage.getItem('hint_popup_pos') ?? 'null') ?? { x: 0, y: 0 } } catch { return { x: 0, y: 0 } }
  })
  const [popupSize, setPopupSize] = useState<{ w: number; h: number }>(() => {
    try { return JSON.parse(localStorage.getItem('hint_popup_size') ?? 'null') ?? { w: 560, h: 420 } } catch { return { w: 560, h: 420 } }
  })
  const [popupOpacity, setPopupOpacity] = useState<number>(() => {
    const v = parseFloat(localStorage.getItem('hint_popup_opacity') ?? '')
    return isNaN(v) ? 0.92 : v
  })
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; origX: number; origY: number; dir: string } | null>(null)

  // 修正2: 前のストリームをAbortControllerでキャンセルするためのref
  const streamControllerRef = useRef<AbortController | null>(null)

  // 修正1: overlayのdebounce用ref
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayPayloadRef = useRef<any>(null)

  // 戻るボタン
  const handleBack = useCallback(() => {
    onBack()
  }, [onBack])

  // 機能3: ストリーミングで質問を処理（修正2: AbortController追加）
  const handleQuestionDetected = useCallback(async (question: string) => {
    // 前のストリームをキャンセル
    streamControllerRef.current?.abort()
    const controller = new AbortController()
    streamControllerRef.current = controller

    setCurrentQuestion(question)
    setCurrentHints(null)
    setStreamingAnswer('')
    setIsStreaming(true)
    setIsLoading(false)
    setUserAnswer('')

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/interview/hint-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: sessionId,
          question,
          interview_type: interviewType,
          user_background: userBackground || null,
          job_title: jobTitle || null,
          interview_type_pref: interviewTypePref || null,
        }),
        signal: controller.signal,
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
        if (done || controller.signal.aborted) break
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

      // abortされた場合はstateを更新しない
      if (!controller.signal.aborted) {
        setCurrentHints({ answer: accumulated })
        setIsStreaming(false)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return  // 意図的なキャンセル
      console.error(e)
      setIsStreaming(false)
    }
  }, [sessionId, interviewType, userBackground, token])

  // --- オーバーレイ同期 (Electron IPC + ブラウザ BroadcastChannel)（修正1: debounce追加） ---
  useEffect(() => {
    const payload = {
      question: currentQuestion,
      answer: currentHints?.answer ?? '',
      isStreaming,
      streamingText: streamingAnswer,
    }
    overlayPayloadRef.current = payload

    const sendToOverlay = (p: typeof payload) => {
      const api = (window as any).electronAPI
      if (api?.sendHintsToOverlay) api.sendHintsToOverlay(p)
      sendHintToOverlay(p)
      fetch('/api/overlay/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...p, isRecording: false }),
      }).catch(() => {})
    }

    // ストリーミング完了・停止時は即送信
    if (!isStreaming) {
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current)
        overlayTimerRef.current = null
      }
      sendToOverlay(payload)
      return
    }

    // ストリーミング中は500msごとに1回だけ送る
    if (overlayTimerRef.current) return
    overlayTimerRef.current = setTimeout(() => {
      overlayTimerRef.current = null
      if (overlayPayloadRef.current) sendToOverlay(overlayPayloadRef.current)
    }, 500)

    return () => {
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current)
        overlayTimerRef.current = null
      }
    }
  }, [currentQuestion, currentHints, isStreaming, streamingAnswer])

  // 残り時間が0になったら終了（管理者はスキップ）
  useEffect(() => {
    if (user && !user.is_admin && user.minutes_left === 0) {
      setTimeExpired(true)
    }
  }, [user?.minutes_left, user?.is_admin])

  // ショートカットキーで録音ON/OFF（バックエンド経由）
  const [isRecording, setIsRecording] = useState(false)
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      fetch('/api/audio/stop', { method: 'POST' }).catch(() => {})
      setIsRecording(false)
    } else {
      fetch('/api/audio/start', { method: 'POST' }).catch(() => {})
      setIsRecording(true)
    }
  }, [isRecording])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        toggleRecording()
      } else if (e.key === 'Escape') {
        handleBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBack, toggleRecording])

  const handlePopupResizeStart = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: popupSize.w, origH: popupSize.h, origX: popupPos.x, origY: popupPos.y, dir }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const { startX, startY, origW, origH, origX, origY, dir: d } = resizeRef.current
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let newW = origW, newH = origH, newX = origX, newY = origY
      if (d.includes('e')) newW = Math.max(280, origW + dx)
      if (d.includes('w')) { newW = Math.max(280, origW - dx); newX = origX + (origW - newW) }
      if (d.includes('s')) newH = Math.max(200, origH + dy)
      if (d.includes('n')) { newH = Math.max(200, origH - dy); newY = origY + (origH - newH) }
      setPopupSize({ w: newW, h: newH })
      setPopupPos({ x: newX, y: newY })
      localStorage.setItem('hint_popup_size', JSON.stringify({ w: newW, h: newH }))
      localStorage.setItem('hint_popup_pos', JSON.stringify({ x: newX, y: newY }))
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [popupSize, popupPos])

  const handlePopupDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: popupPos.x, origY: popupPos.y }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const newPos = {
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      }
      setPopupPos(newPos)
      localStorage.setItem('hint_popup_pos', JSON.stringify(newPos))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    e.preventDefault()
  }, [popupPos])

  const handleToggleHintWindow = useCallback(() => {
    fetch('/api/overlay/show', { method: 'POST' }).catch(() => {})
  }, [])

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
          <button
            className="feedback-btn"
            onClick={() => { fetch('/api/audio/stop', { method: 'POST' }).catch(() => {}); setIsRecording(false); setShowFeedback(true) }}
            disabled={qaHistory.length === 0}
          >
            セッション終了・総評
          </button>
        </div>
      </header>

      <div className="realtime-layout">
        <div className="voice-panel">
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
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <button
            onClick={handleToggleHintWindow}
            style={{
              padding: '16px 32px',
              fontSize: 18,
              fontWeight: 700,
              background: 'rgba(99,102,241,0.85)',
              color: '#fff',
              border: '2px solid #6366f1',
              borderRadius: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: isStreaming ? '0 0 24px rgba(99,102,241,0.6)' : '0 4px 16px rgba(99,102,241,0.3)',
              transition: 'all 0.2s',
              animation: isStreaming ? 'pulse-btn 1.2s infinite' : 'none',
            }}
          >
            <span style={{ fontSize: 22 }}>💡</span>
            💡 ヒントを見る
            {isStreaming && <span style={{ fontSize: 12, opacity: 0.8 }}>生成中...</span>}
          </button>

          {/* インラインヒントポップアップ（半透明・ドラッグ・全辺リサイズ） */}
          {showHintPopup && (
            <div
              style={{
                position: 'fixed',
                left: `calc(50% + ${popupPos.x}px)`,
                top: `calc(50% + ${popupPos.y}px)`,
                transform: 'translate(-50%, -50%)',
                width: popupSize.w,
                height: popupSize.h,
                minWidth: 280,
                minHeight: 200,
                background: `rgba(10, 15, 30, ${popupOpacity})`,
                border: '1px solid rgba(99,102,241,0.5)',
                borderRadius: 16,
                boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 9999,
              }}
            >
              {/* リサイズハンドル（全辺・全角） */}
              {(['n','s','e','w','ne','nw','se','sw'] as const).map(dir => {
                const isCorner = dir.length === 2
                const cursorMap: Record<string, string> = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' }
                const style: React.CSSProperties = {
                  position: 'absolute', zIndex: 10,
                  ...(dir.includes('n') ? { top: 0 } : {}),
                  ...(dir.includes('s') ? { bottom: 0 } : {}),
                  ...(dir.includes('e') ? { right: 0 } : {}),
                  ...(dir.includes('w') ? { left: 0 } : {}),
                  ...(isCorner ? { width: 12, height: 12 } : dir === 'n' || dir === 's' ? { left: 12, right: 12, height: 6 } : { top: 12, bottom: 12, width: 6 }),
                  cursor: cursorMap[dir],
                }
                return <div key={dir} style={style} onMouseDown={e => handlePopupResizeStart(e, dir)} />
              })}

              {/* ドラッグ可能なヘッダー */}
              <div
                onMouseDown={handlePopupDragStart}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'rgba(99,102,241,0.2)',
                  borderBottom: '1px solid rgba(99,102,241,0.3)',
                  flexShrink: 0, cursor: 'grab', userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>💡</span>
                  <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 14 }}>ヒントパネル</span>
                  {isStreaming && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', display: 'inline-block', animation: 'pulse-btn 1s infinite' }} />}
                </div>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => setShowHintPopup(false)}
                  style={{ background: 'rgba(239,68,68,0.25)', border: 'none', borderRadius: 5, color: '#fca5a5', fontSize: 12, padding: '3px 9px', cursor: 'pointer' }}
                >✕ 閉じる</button>
              </div>

              {/* 本文 */}
              <div style={{ overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                {!currentQuestion && !isStreaming ? (
                  <div style={{ textAlign: 'center', padding: '28px 12px', color: '#475569' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                    <p style={{ margin: 0, fontSize: 13 }}>面接官の質問を話しかけてください</p>
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: '#334155' }}>音声認識後にここにヒントが表示されます</p>
                  </div>
                ) : (
                  <>
                    {currentQuestion && (
                      <div style={{ background: 'rgba(30,58,138,0.4)', borderLeft: '3px solid #3b82f6', borderRadius: 8, padding: '10px 14px' }}>
                        <p style={{ margin: '0 0 4px', fontSize: 10, color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>検出された質問</p>
                        <p style={{ margin: 0, fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>{currentQuestion}</p>
                      </div>
                    )}
                    {(streamingAnswer || currentHints?.answer) && (
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: 10, color: '#86efac', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>模範回答</p>
                        <div style={{ background: 'rgba(5,46,22,0.4)', borderLeft: '3px solid #22c55e', borderRadius: 8, padding: '12px 14px' }}>
                          <p style={{ margin: 0, fontSize: 14, color: '#dcfce7', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                            {isStreaming ? streamingAnswer : currentHints?.answer}
                            {isStreaming && <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#22c55e', marginLeft: 2, animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 透明度スライダー（下部固定） */}
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{ flexShrink: 0, padding: '8px 14px', borderTop: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,15,30,0.5)' }}
              >
                <span style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>透明度</span>
                <input type="range" min={0.1} max={1} step={0.05} value={popupOpacity}
                  onChange={e => { const v = parseFloat(e.target.value); setPopupOpacity(v); localStorage.setItem('hint_popup_opacity', String(v)) }}
                  style={{ flex: 1, accentColor: '#6366f1', cursor: 'pointer' }} />
                <span style={{ color: '#64748b', fontSize: 11, width: 32, textAlign: 'right' }}>{Math.round(popupOpacity * 100)}%</span>
              </div>
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
