import { useState, useCallback, useEffect, useRef } from 'react'
import { InterviewType, HintResponse, RichHintResponse } from '../types'
import FeedbackPanel from './FeedbackPanel'
import { useAuth } from '../hooks/useAuth'
import { sendHintToOverlay } from './OverlayButton'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

const MODE_OPTIONS: { key: AnswerMode; label: string; description: string }[] = [
  { key: 'ai', label: 'AI生成', description: '登録回答がない質問にも、AIがその場で回答案を作ります' },
  { key: 'registered', label: '登録回答', description: '事前に登録した回答から近いものを表示します' },
  { key: 'hybrid', label: 'おまかせ', description: '質問内容に合わせて、登録回答とAI生成を自動で使い分けます' },
]


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

type AnswerMode = 'ai' | 'registered' | 'hybrid'

function parseStreamText(raw: string): {
  metaFound: boolean
  mode: AnswerMode
  category: string
  reason: string
  answer: string
  followUp: string
} {
  const metaRegex = /^##META:([^|#]*)\|([^|#]*)\|([^#]*)##\n?/
  const metaMatch = raw.match(metaRegex)

  let mode: AnswerMode = 'ai'
  let category = ''
  let reason = ''
  let text = raw
  let metaFound = false

  if (metaMatch) {
    metaFound = true
    const m = metaMatch[1]
    mode = (m === 'registered' || m === 'hybrid' ? m : 'ai')
    category = metaMatch[2] || ''
    reason = metaMatch[3] || ''
    text = raw.slice(metaMatch[0].length)
  }

  const followupIdx = text.indexOf('##FOLLOWUP##')
  let answer = text
  let followUp = ''
  if (followupIdx !== -1) {
    answer = text.slice(0, followupIdx).trim()
    followUp = text.slice(followupIdx + 12).trim()
  }

  return { metaFound, mode, category, reason, answer, followUp }
}

export default function RealtimeMode({ sessionId, interviewType, userBackground, jobTitle, interviewTypePref, onBack, onShowPricing }: Props) {
  const { user, token } = useAuth()
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
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

  // 事前選択モード（質問が来る前にユーザーが選ぶ）。初期値は「おまかせ」
  const [selectedMode, setSelectedMode] = useState<AnswerMode>('hybrid')
  const selectedModeRef = useRef<AnswerMode>('hybrid')

  // ブラウザ版: リッチな回答（30秒版/60秒版/使った情報/注意点/判定理由）
  const [richResult, setRichResult] = useState<RichHintResponse | null>(null)
  const [richLoading, setRichLoading] = useState(false)

  // モード表示用 state（実際に使われたモード）
  const [answerMode, setAnswerMode] = useState<AnswerMode>('ai')
  const [matchCategory, setMatchCategory] = useState('')
  const [matchReason, setMatchReason] = useState('')
  const [followUpText, setFollowUpText] = useState('')

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

  // ブラウザ版用: 30秒版/60秒版/使った情報/注意点/判定理由を含むリッチな回答を取得する
  const fetchRichHint = useCallback(async (question: string, forcedMode?: AnswerMode) => {
    setRichLoading(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api/interview/hint`, {
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
          forced_mode: forcedMode || null,
        }),
      })
      if (!res.ok) {
        setRichLoading(false)
        return
      }
      const data: RichHintResponse = await res.json()
      setRichResult(data)
    } catch (e) {
      console.error('Rich hint fetch failed:', e)
    } finally {
      setRichLoading(false)
    }
  }, [sessionId, interviewType, userBackground, jobTitle, interviewTypePref, token])

  // 機能3: ストリーミングで質問を処理（修正2: AbortController追加）
  const handleQuestionDetected = useCallback(async (question: string, forcedMode?: AnswerMode) => {
    // 前のストリームをキャンセル
    streamControllerRef.current?.abort()
    const controller = new AbortController()
    streamControllerRef.current = controller

    setCurrentQuestion(question)
    setCurrentHints(null)
    setStreamingAnswer('')
    setAnswerMode('ai')
    setMatchCategory('')
    setMatchReason('')
    setFollowUpText('')
    setIsStreaming(true)
    setIsLoading(false)
    setUserAnswer('')
    setRichResult(null)

    // ブラウザ版では、ページ内表示用に30秒版/60秒版/使った情報/注意点を含む
    // リッチな回答も並行して取得する（ストリーミング版とは別エンドポイント）
    if (!isElectron) {
      fetchRichHint(question, forcedMode)
    }

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
          forced_mode: forcedMode || null,
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
            const parsed = parseStreamText(accumulated)
            setAnswerMode(parsed.mode)
            setMatchCategory(parsed.category)
            setMatchReason(parsed.reason)
            setStreamingAnswer(parsed.answer)
          }
        }
      }

      // abortされた場合はstateを更新しない
      if (!controller.signal.aborted) {
        const parsed = parseStreamText(accumulated)
        setAnswerMode(parsed.mode)
        setMatchCategory(parsed.category)
        setMatchReason(parsed.reason)
        setFollowUpText(parsed.followUp)
        setCurrentHints({ answer: parsed.answer })
        setIsStreaming(false)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return  // 意図的なキャンセル
      console.error(e)
      setIsStreaming(false)
    }
  }, [sessionId, interviewType, userBackground, token, isElectron, fetchRichHint])

  // --- オーバーレイ同期 (Electron IPC + ブラウザ BroadcastChannel)（修正1: debounce追加） ---
  useEffect(() => {
    const payload = {
      question: currentQuestion,
      answer: currentHints?.answer ?? '',
      isStreaming,
      streamingText: streamingAnswer,
      mode: answerMode,
      matchCategory,
      matchReason,
      followUp: followUpText,
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

  // 音声ポーリング用 ref
  const audioPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const accumulatedTranscriptRef = useRef('')
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [liveTranscript, setLiveTranscript] = useState('')

  // --- 録音（デスクトップ版: システム音声ループバック / ブラウザ版: マイク直録） ---
  // デスクトップ版はバックエンドがPC自体のシステム音声（Zoom等の出力）を録音する。
  // ブラウザ版はバックエンドとユーザーのPCが別々の可能性があるため、
  // ブラウザ自身のマイクAPIで録音しWhisperへアップロードする（useSpeechRecognition）
  const speech = useSpeechRecognition(interviewType, (q) => {
    handleQuestionDetected(q, selectedModeRef.current)
  })

  // マウント時: デスクトップ版のみシステム音声の自動録音を開始する
  useEffect(() => {
    if (!isElectron) return
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000'
    fetch(`${apiBase}/api/audio/start`, { method: 'POST' }).catch(() => {})
    setIsRecording(true)

    audioPollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/api/audio/latest`)
        if (!r.ok) return
        const data = await r.json() as { ok: boolean; text: string | null; recording: boolean }
        if (!data.text) return
        accumulatedTranscriptRef.current += data.text + ' '
        setLiveTranscript(accumulatedTranscriptRef.current)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => {
          const q = accumulatedTranscriptRef.current.trim()
          accumulatedTranscriptRef.current = ''
          setLiveTranscript('')
          if (q.length >= 5) handleQuestionDetected(q, selectedModeRef.current)
        }, 3000)
      } catch {
        // バックエンド未接続は無視
      }
    }, 2000)

    return () => {
      if (audioPollRef.current) clearInterval(audioPollRef.current)
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      fetch(`${apiBase}/api/audio/stop`, { method: 'POST' }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron])

  // 録音ON/OFF（デスクトップ版はシステム音声ポーリング、ブラウザ版はマイク録音）
  const [isRecording, setIsRecording] = useState(false)
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null)
  const [recordingElapsed, setRecordingElapsed] = useState(0)

  const toggleRecording = useCallback(() => {
    if (isElectron) {
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000'
      if (isRecording) {
        fetch(`${apiBase}/api/audio/stop`, { method: 'POST' }).catch(() => {})
        setIsRecording(false)
      } else {
        fetch(`${apiBase}/api/audio/start`, { method: 'POST' }).catch(() => {})
        setIsRecording(true)
      }
      return
    }
    // ブラウザ版: マイク録音の開始/停止
    if (speech.isListening) {
      speech.stopListening()
    } else {
      speech.clearPermissionError()
      speech.startListening()
    }
  }, [isElectron, isRecording, speech])

  // ブラウザ版: マイクの実際の録音状態を isRecording / 経過時間に反映する
  useEffect(() => {
    if (isElectron) return
    setIsRecording(speech.isListening)
    if (speech.isListening) {
      setRecordingStartedAt(Date.now())
    } else {
      setRecordingStartedAt(null)
      setRecordingElapsed(0)
    }
  }, [isElectron, speech.isListening])

  // 経過時間タイマー（1秒ごと）
  useEffect(() => {
    if (!isRecording || recordingStartedAt === null) return
    const timer = setInterval(() => {
      setRecordingElapsed(Math.floor((Date.now() - recordingStartedAt) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRecording, recordingStartedAt])

  // ブラウザ版: 録音中にページを離れようとしたら警告する
  useEffect(() => {
    if (isElectron) return
    if (!isRecording) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isElectron, isRecording])

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
    // Electronアプリ内ではIPC経由で直接オーバーレイを表示する（オーバーレイが閉じられていても
    // main.js側の再作成ロジックで復活する、より確実な経路）。
    // ブラウザ単体で開いている場合はHTTP経由のSSEリレーにフォールバックする
    const api = (window as any).electronAPI
    if (api?.showOverlay) {
      api.showOverlay()
      return
    }
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
    handleQuestionDetected(manualQuestion.trim(), selectedMode)
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

  const recTimeStr = `${Math.floor(recordingElapsed / 60)}:${String(recordingElapsed % 60).padStart(2, '0')}`

  return (
    <div className="realtime-mode">
      <header className="mode-header">
        <button className="back-btn" onClick={handleBack}>← 戻る</button>
        <div className="mode-info">
          <span className="mode-badge realtime">リアルタイム</span>
          <span className="interview-type">{interviewType}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 録音ON/OFFスイッチ */}
          {!isElectron && !speech.micSupported ? (
            <div style={{ fontSize: 12, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '6px 10px', maxWidth: 260 }}>
              このブラウザはマイク録音に対応していません。最新のChrome/Edge/Safariをお使いください。質問は下の「手動で質問を入力」から送れます。
            </div>
          ) : (
            <button
              onClick={toggleRecording}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 14px',
                borderRadius: 20,
                border: isRecording ? '1px solid rgba(239,68,68,0.6)' : '1px solid rgba(148,163,184,0.4)',
                background: isRecording ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)',
                color: isRecording ? '#fca5a5' : '#cbd5e1',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
              title={isElectron ? 'システム音声の録音をON/OFF（ショートカット: R）' : 'マイク録音をON/OFF（ショートカット: R）'}
            >
              <span style={{ fontSize: 16 }}>{isRecording ? '⏺️' : '🎙️'}</span>
              {isRecording ? `録音中 ${recTimeStr}` : '録音を開始'}
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: isRecording ? '#ef4444' : '#475569', display: 'inline-block', animation: isRecording ? 'pulse-btn 1.2s infinite' : 'none' }} />
            </button>
          )}
          <button
            className="feedback-btn"
            onClick={() => {
              const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000'
              fetch(`${apiBase}/api/audio/stop`, { method: 'POST' }).catch(() => {})
              if (isRecording && !isElectron) speech.stopListening()
              setIsRecording(false)
              setShowFeedback(true)
            }}
          >
            セッション終了・総評
          </button>
        </div>
      </header>

      {/* 録音の注意文（短く。詳細は説明ページへ） */}
      {!isElectron && (
        <div style={{ fontSize: 11, color: '#64748b', padding: '4px 20px', background: 'rgba(255,255,255,0.02)' }}>
          録音は面接練習・準備のために使用してください。第三者との会話を録音する場合は、相手の同意や利用規約を確認してください。
          {' '}<a href="/desktop-guide" style={{ color: '#818cf8', whiteSpace: 'nowrap' }}>詳しくはこちら</a>
        </div>
      )}

      {/* マイク許可エラー */}
      {!isElectron && speech.permissionError && (
        <div style={{ margin: '8px 20px 0', fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span>
            {speech.permissionError === 'denied' && '🚫 マイクへのアクセスが拒否されています。ブラウザのアドレスバー付近のマイクアイコンから許可してください。'}
            {speech.permissionError === 'not-found' && '🎤 マイクが見つかりませんでした。PCにマイクが接続・有効になっているか確認してください。'}
            {speech.permissionError === 'unsupported' && 'このブラウザ・環境ではマイク録音を利用できません。'}
            {speech.permissionError === 'unknown' && 'マイクの起動に失敗しました。時間をおいて再度お試しください。'}
          </span>
          <button onClick={speech.clearPermissionError} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* 回答モード切替スイッチ（ブラウザ・デスクトップ共通） */}
      <div style={{ padding: '10px 20px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: '#64748b' }}>現在のモード：{MODE_OPTIONS.find(m => m.key === selectedMode)?.label}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODE_OPTIONS.map(({ key, label }) => {
            const isActive = selectedMode === key
            return (
              <button
                key={key}
                onClick={() => { selectedModeRef.current = key; setSelectedMode(key) }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: isActive ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.15)',
                  background: isActive
                    ? (key === 'registered' ? '#065f46' : key === 'hybrid' ? '#78350f' : '#312e81')
                    : 'rgba(255,255,255,0.06)',
                  color: isActive ? '#fff' : '#94a3b8',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          {MODE_OPTIONS.find(m => m.key === selectedMode)?.description}
        </div>
      </div>

      <div className="realtime-layout">
        <div className="voice-panel">
          <div className="manual-input">
            {liveTranscript && (
              <div style={{ fontSize: 12, color: '#94a3b8', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: 'pulse-btn 1s infinite' }} />
                {liveTranscript}
              </div>
            )}
            {!isElectron && speech.transcript && (
              <div style={{ fontSize: 12, color: '#94a3b8', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1', display: 'inline-block', animation: speech.isListening ? 'pulse-btn 1s infinite' : 'none' }} />
                {speech.transcript}
              </div>
            )}
            <p className="section-label">手動で質問を入力</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 6px' }}>
                <kbd>R</kbd> 録音切替
              </span>
              <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 6px' }}>
                <kbd>Esc</kbd> 戻る
              </span>
              <span style={{ fontSize: 11, color: '#64748b', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 6px' }}>
                <kbd>Enter</kbd> 質問送信
              </span>
            </div>
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
          {/* 「ヒントを見る」はZoom等の上に浮かせるオーバーレイをデスクトップアプリ側で
              前面に呼び出すための機能。ブラウザ単体ではオーバーレイ自体が存在せず押しても
              何も起きないため、Electron環境でのみ表示する（ブラウザではヒントは下に自動表示される）*/}
          {typeof window !== 'undefined' && (window as any).electronAPI && (
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
            ヒントを見る
            {isStreaming && <span style={{ fontSize: 12, opacity: 0.8 }}>生成中...</span>}
          </button>
          )}

          {/* ブラウザ版: ヒントはページ内に自動表示する（デスクトップ版の透明パネルは使わない） */}
          {!isElectron && (
            <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 4px 24px' }}>
              {!currentQuestion && !isStreaming && !richLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 12px', color: '#475569' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>🎯</div>
                  <p style={{ margin: 0, fontSize: 14 }}>録音を開始して質問を話しかけるか、下に直接入力してください</p>
                </div>
              ) : (
                <>
                  {/* 中央：検出された質問 */}
                  {currentQuestion && (
                    <div style={{ background: 'rgba(30,58,138,0.4)', borderLeft: '3px solid #3b82f6', borderRadius: 8, padding: '12px 16px' }}>
                      <p style={{ margin: '0 0 4px', fontSize: 10, color: '#93c5fd', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>AIが認識した質問</p>
                      <p style={{ margin: 0, fontSize: 15, color: '#e2e8f0', lineHeight: 1.6 }}>{currentQuestion}</p>
                    </div>
                  )}

                  {/* 下部：使用モード・判定結果 */}
                  {(richResult?.mode || answerMode) && (currentHints || richResult) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, color: '#fff',
                        background: (richResult?.mode ?? answerMode) === 'registered' ? '#065f46' : (richResult?.mode ?? answerMode) === 'hybrid' ? '#78350f' : '#312e81',
                      }}>
                        使用モード：{MODE_OPTIONS.find(m => m.key === (richResult?.mode ?? answerMode))?.label ?? 'AI生成'}
                      </span>
                      {(richResult?.match_reason || matchReason) && (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          判定結果：{richResult?.match_category || matchCategory ? `登録回答「${richResult?.match_category || matchCategory}」を使用 — ` : ''}
                          {richResult?.match_reason || matchReason}
                        </span>
                      )}
                    </div>
                  )}

                  {/* すぐ出るクイック回答（ストリーミング） */}
                  {(streamingAnswer || currentHints?.answer) && (
                    <div>
                      <p style={{ margin: '0 0 6px', fontSize: 10, color: '#86efac', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>回答案</p>
                      <div style={{ background: 'rgba(5,46,22,0.4)', borderLeft: '3px solid #22c55e', borderRadius: 8, padding: '12px 16px' }}>
                        <p style={{ margin: 0, fontSize: 14, color: '#dcfce7', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                          {isStreaming ? streamingAnswer : currentHints?.answer}
                          {isStreaming && <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#22c55e', marginLeft: 2, animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* リッチな詳細（30秒版/60秒版/深掘り/使った情報/注意点） */}
                  {richLoading && (
                    <p style={{ fontSize: 12, color: '#64748b' }}>詳しい回答案（30秒版・60秒版）を作成中...</p>
                  )}
                  {richResult && (
                    <>
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: 10, color: '#7dd3fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>30秒版</p>
                        <div style={{ background: 'rgba(8,47,73,0.35)', borderLeft: '3px solid #0ea5e9', borderRadius: 8, padding: '10px 14px' }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#e0f2fe', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{richResult.answer_30s}</p>
                        </div>
                      </div>
                      <div>
                        <p style={{ margin: '0 0 6px', fontSize: 10, color: '#a5b4fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>60秒版</p>
                        <div style={{ background: 'rgba(49,46,129,0.3)', borderLeft: '3px solid #6366f1', borderRadius: 8, padding: '10px 14px' }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#e0e7ff', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{richResult.answer_60s}</p>
                        </div>
                      </div>
                      {richResult.follow_up_questions?.length > 0 && (
                        <div>
                          <p style={{ margin: '0 0 6px', fontSize: 10, color: '#fb923c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>深掘り対策</p>
                          <div style={{ background: 'rgba(124,45,18,0.25)', borderLeft: '3px solid #f97316', borderRadius: 8, padding: '10px 14px' }}>
                            {richResult.follow_up_questions.map((q, i) => (
                              <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0', fontSize: 13, color: '#fed7aa', lineHeight: 1.6 }}>・{q}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      {(richResult.used_info?.personal || richResult.used_info?.company || richResult.used_info?.registered_answer) && (
                        <div>
                          <p style={{ margin: '0 0 6px', fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>使った情報</p>
                          <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.8 }}>
                            <p style={{ margin: 0 }}>・個人情報：{richResult.used_info.personal || '特になし'}</p>
                            <p style={{ margin: 0 }}>・企業情報：{richResult.used_info.company || '特になし'}</p>
                            <p style={{ margin: 0 }}>・登録回答：{richResult.used_info.registered_answer || '特になし'}</p>
                          </div>
                        </div>
                      )}
                      {richResult.caution && (
                        <div style={{ background: 'rgba(113,63,18,0.25)', border: '1px solid rgba(234,179,8,0.4)', borderRadius: 8, padding: '10px 14px' }}>
                          <p style={{ margin: 0, fontSize: 12, color: '#fde68a' }}>⚠️ 注意点：{richResult.caution}</p>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

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
                {/* モード選択（常時表示・質問が来る前に選ぶ） */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {([
                    { key: 'ai' as AnswerMode, label: '🤖 AI生成' },
                    { key: 'registered' as AnswerMode, label: '✓ 登録回答' },
                    { key: 'hybrid' as AnswerMode, label: '⚡ ハイブリッド' },
                  ]).map(({ key, label }) => {
                    const isActive = selectedMode === key
                    return (
                      <button
                        key={key}
                        onClick={() => { selectedModeRef.current = key; setSelectedMode(key) }}
                        style={{
                          flex: 1,
                          padding: '5px 0',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: isActive ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.2)',
                          background: isActive
                            ? (key === 'registered' ? '#065f46' : key === 'hybrid' ? '#78350f' : '#312e81')
                            : 'rgba(255,255,255,0.08)',
                          color: isActive ? '#fff' : '#94a3b8',
                          transition: 'all 0.15s',
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

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
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {matchReason && (
                          <p style={{ margin: 0, fontSize: 10, color: '#475569' }}>{matchReason}</p>
                        )}

                        {/* 回答テキスト */}
                        <div>
                          <p style={{ margin: '0 0 6px', fontSize: 10, color: '#86efac', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>回答案</p>
                          <div style={{ background: 'rgba(5,46,22,0.4)', borderLeft: '3px solid #22c55e', borderRadius: 8, padding: '12px 14px' }}>
                            <p style={{ margin: 0, fontSize: 14, color: '#dcfce7', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                              {isStreaming ? streamingAnswer : currentHints?.answer}
                              {isStreaming && <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#22c55e', marginLeft: 2, animation: 'blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />}
                            </p>
                          </div>
                        </div>

                        {/* 深掘り対策 */}
                        {!isStreaming && followUpText && (
                          <div>
                            <p style={{ margin: '0 0 6px', fontSize: 10, color: '#fb923c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>深掘り対策</p>
                            <div style={{ background: 'rgba(124,45,18,0.25)', borderLeft: '3px solid #f97316', borderRadius: 8, padding: '10px 14px' }}>
                              <p style={{ margin: 0, fontSize: 13, color: '#fed7aa', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{followUpText}</p>
                            </div>
                          </div>
                        )}
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
