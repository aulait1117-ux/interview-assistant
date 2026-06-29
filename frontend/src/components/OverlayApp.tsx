import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

/** メインアプリから受け取るヒントデータ */
interface OverlayHintData {
  question: string
  answer: string
  isStreaming: boolean
  streamingText: string
  isRecording?: boolean
}

/** overlayAPI の型定義（window に注入される） */
declare global {
  interface Window {
    overlayAPI?: {
      hide: () => void
      focus: () => void
      moveWindow: (dx: number, dy: number) => void
      setOpacity: (opacity: number) => void
      getPosition: () => Promise<{ x: number; y: number }>
      getSize: () => Promise<{ width: number; height: number }>
      setBounds: (x: number, y: number, width: number, height: number) => void
      resizeStart: (params: { dir: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number }) => void
      resizeEnd: () => void
      setIgnoreMouse: (ignore: boolean) => void
      onHintsUpdated: (cb: (data: OverlayHintData) => void) => () => void
      isElectron: boolean
      isOverlay: boolean
      platform: string
    }
  }
}

/** ブラウザモードでのウィンドウ位置（CSS drag用） */
interface BrowserPos {
  x: number
  y: number
}

export default function OverlayApp() {
  const [hintData, setHintData] = useState<OverlayHintData | null>(null)
  const [answerOpacity, setAnswerOpacity] = useState(1.0)
  const [windowOpacity, setWindowOpacity] = useState(0.9)
  const [textColor, setTextColor] = useState('#dcfce7')
  const [isMinimized, setIsMinimized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing' | 'no-audio'>('idle')
  const [liveTranscript, setLiveTranscript] = useState('')
  // ブラウザモード用: CSS でパネルを動かすための位置 state
  const [browserPos, setBrowserPos] = useState<BrowserPos>({ x: 10, y: 10 })

  const isElectronOverlay = !!window.overlayAPI
  const overlayAPI = window.overlayAPI as any

  // バックエンド録音用
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const accumulatedRef = useRef('')
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apiBase = useMemo(() => 'http://localhost:8000', [])

  const [backendReachable, setBackendReachable] = useState<boolean | null>(null)

  // 起動時にバックエンド疎通確認 → 確認OK後に自動録音開始
  useEffect(() => {
    fetch('http://localhost:8000/')
      .then(r => r.json())
      .then(() => {
        setBackendReachable(true)
        console.log('[Overlay] バックエンド接続OK → 自動録音開始')
        // 自動でバックエンド録音を開始
        fetch('http://localhost:8000/api/audio/start', { method: 'POST' })
          .then(r => r.json())
          .then(d => {
            console.log('[Overlay] 録音開始:', d)
            setIsRecording(true)
            setCaptureStatus('capturing')
            // ポーリング開始
            pollTimerRef.current = setInterval(async () => {
              try {
                const r2 = await fetch('http://localhost:8000/api/audio/latest')
                if (!r2.ok) return
                const data = await r2.json() as { ok: boolean; text: string | null; recording: boolean }
                // バックエンド再起動後に録音が止まっていたら自動再開
                if (data.recording === false) {
                  fetch('http://localhost:8000/api/audio/start', { method: 'POST' }).catch(() => {})
                  return
                }
                if (!data.text) return
                console.log('[Overlay] transcript:', data.text)
                accumulatedRef.current += data.text + ' '
                setLiveTranscript(accumulatedRef.current)
                if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
                silenceTimerRef.current = setTimeout(async () => {
                  const q = accumulatedRef.current.trim()
                  console.log('[Overlay] silence timer fired, q=', q)
                  if (q.length < 5) return
                  accumulatedRef.current = ''
                  setLiveTranscript('')
                  // まず直接状態を更新（APIなし）
                  setHintData({ question: q, answer: '', isStreaming: true, streamingText: '' })
                  setIsMinimized(false)
                  try {
                    const hintRes = await fetch(`${apiBase}/api/interview/overlay-hint-stream`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        session_id: 'overlay-session',
                        question: q,
                        interview_type: localStorage.getItem('interview_type') || '技術面接',
                        user_background: null,
                      }),
                    })
                    console.log('[Overlay] hint-stream status=', hintRes.status)
                    if (!hintRes.ok || !hintRes.body) {
                      setHintData(prev => prev ? { ...prev, isStreaming: false, answer: '(ログインが必要です)' } : prev)
                      return
                    }
                    const reader = hintRes.body.getReader()
                    const decoder = new TextDecoder()
                    let answer = ''
                    while (true) {
                      const { done, value } = await reader.read()
                      if (done) break
                      const chunk = decoder.decode(value, { stream: true })
                      for (const line of chunk.split('\n')) {
                        if (line.startsWith('data: ')) {
                          const t = line.slice(6)
                          if (t === '[DONE]') continue
                          answer += t
                          setHintData(prev => prev ? { ...prev, streamingText: answer, isStreaming: true } : prev)
                        }
                      }
                    }
                    setHintData(prev => prev ? { ...prev, answer, isStreaming: false, streamingText: '' } : prev)
                  } catch (e) {
                    console.error('[Overlay] hint error:', e)
                    setHintData(prev => prev ? { ...prev, isStreaming: false, answer: String(e) } : prev)
                  }
                }, 1500)
              } catch { /* ignore */ }
            }, 1000)
          })
          .catch(e => console.error('[Overlay] 録音開始失敗:', e))
      })
      .catch(() => {
        setBackendReachable(false)
        console.error('[Overlay] バックエンド接続NG')
      })

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      fetch('http://localhost:8000/api/audio/stop', { method: 'POST' }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Electronモード: 起動時は透明部分をクリック貫通、パネル上だけ受け取る
  useEffect(() => {
    if (!isElectronOverlay) return
    window.overlayAPI!.setIgnoreMouse(true)
  }, [isElectronOverlay])

  const fireHint = useCallback(async (q: string) => {
    setHintData({ question: q, answer: '', isStreaming: true, streamingText: '' })
    setIsMinimized(false)
    const token = localStorage.getItem('token')
    try {
      const hintRes = await fetch(`${apiBase}/api/interview/hint-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: localStorage.getItem('overlay_session_id') || 'overlay-session',
          question: q,
          interview_type: localStorage.getItem('interview_type') || '技術面接',
          user_background: localStorage.getItem('user_background') || null,
        }),
      })
      if (!hintRes.ok || !hintRes.body) {
        setHintData(prev => prev ? { ...prev, isStreaming: false } : prev)
        return
      }
      const reader = hintRes.body.getReader()
      const decoder = new TextDecoder()
      let answer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const t = line.slice(6)
            if (t === '[DONE]') continue
            answer += t
            setHintData(prev => prev ? { ...prev, streamingText: answer, isStreaming: true } : prev)
          }
        }
      }
      setHintData(prev => prev ? { ...prev, answer, isStreaming: false, streamingText: '' } : prev)
    } catch { /* ignore */ }
  }, [apiBase])

  // ---- システム音声キャプチャ（Pythonバックエンド WASAPIループバック・ポーリング） ----
  const startElectronCapture = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/audio/start`, { method: 'POST' })
      if (!res.ok) return
      setIsRecording(true)
      setCaptureStatus('capturing')

      // 2秒ごとにポーリング
      pollTimerRef.current = setInterval(async () => {
        try {
          const r = await fetch(`${apiBase}/api/audio/latest`)
          if (!r.ok) return
          const data = await r.json() as { ok: boolean; text: string | null }
          if (!data.text) return

          accumulatedRef.current += data.text + ' '
          setLiveTranscript(accumulatedRef.current)

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = setTimeout(async () => {
            const q = accumulatedRef.current.trim()
            if (q.length < 5) return
            accumulatedRef.current = ''
            setLiveTranscript('')
            await fireHint(q)
          }, 3000)
        } catch { /* ignore */ }
      }, 2000)
    } catch (err) {
      console.error('Backend audio capture error:', err)
    }
  }, [apiBase, fireHint])

  const stopElectronCapture = useCallback(async () => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    accumulatedRef.current = ''
    setIsRecording(false)
    setCaptureStatus('idle')
    setLiveTranscript('')
    await fetch(`${apiBase}/api/audio/stop`, { method: 'POST' }).catch(() => {})
  }, [apiBase])

  const handleWindowOpacity = (val: number) => {
    setWindowOpacity(val)
    if (isElectronOverlay) {
      window.overlayAPI!.setOpacity(val)
    }
  }

  // ドラッグ用 ref
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0 })

  // 全辺リサイズハンドラー（メインプロセスのカーソルポーリング使用）
  const handleResizeStart = useCallback(async (e: React.MouseEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    const api = window.overlayAPI
    if (!api) return
    const pos = await api.getPosition()
    const size = await api.getSize()
    api.resizeStart({
      dir,
      startX: e.screenX,
      startY: e.screenY,
      origX: pos.x,
      origY: pos.y,
      origW: size.width,
      origH: size.height,
    })
    const onUp = () => {
      api.resizeEnd()
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mouseup', onUp)
  }, [])

  // メインアプリからのヒント受信 — Electron IPC または BroadcastChannel
  useEffect(() => {
    // --- Electron IPC モード（ヒントデータはIPCで受信）---
    const api = window.overlayAPI
    let ipcUnsubscribe: (() => void) | undefined
    if (api) {
      ipcUnsubscribe = api.onHintsUpdated((data) => {
        setHintData(data)
        if (data.question) setIsMinimized(false)
      })
    }

    // --- バックエンド SSE（自動再接続付き）---
    const sseBase = 'http://localhost:8000'
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    const handleSseMessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed.ping || parsed.connected) return
        if (parsed._control === 'show') {
          if (window.overlayAPI) {
            window.overlayAPI.focus()
          } else {
            window.focus()
          }
          setIsMinimized(false)
          return
        }
        if (typeof parsed.isRecording === 'boolean') {
          setIsRecording(parsed.isRecording)
        }
        if (!api) {
          const data = parsed as OverlayHintData
          setHintData(data)
          if (data.question) setIsMinimized(false)
        }
      } catch {}
    }

    const connectSse = () => {
      if (destroyed) return
      es = new EventSource(`${sseBase}/api/overlay/stream`)
      es.onmessage = handleSseMessage
      es.onerror = () => {
        es?.close()
        es = null
        if (!destroyed) {
          retryTimer = setTimeout(connectSse, 3000)
        }
      }
    }
    connectSse()

    // --- ブラウザ BroadcastChannel（同一ブラウザ内連携）---
    const channel = new BroadcastChannel('overlay-channel')
    channel.onmessage = (event: MessageEvent) => {
      const { type, data } = event.data as { type: string; data: OverlayHintData }
      if (type === 'hint' && !api) {
        setHintData(data)
        if (data.question) setIsMinimized(false)
      }
    }
    return () => {
      destroyed = true
      if (retryTimer) clearTimeout(retryTimer)
      ipcUnsubscribe?.()
      es?.close()
      channel.close()
    }
  }, [])

  // ドラッグ開始
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    dragStartRef.current = { mouseX: e.screenX, mouseY: e.screenY }
    e.preventDefault()
  }, [])

  // グローバル mousemove / mouseup でウィンドウを動かす
  useEffect(() => {
    if (!isDragging) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.screenX - dragStartRef.current.mouseX
      const dy = e.screenY - dragStartRef.current.mouseY
      dragStartRef.current = { mouseX: e.screenX, mouseY: e.screenY }
      if (isElectronOverlay) {
        // Electron モード: IPC でメインプロセスがウィンドウを動かす
        window.overlayAPI?.moveWindow(dx, dy)
      } else {
        // ブラウザモード: CSS position を更新してパネルを動かす
        setBrowserPos(prev => ({
          x: Math.max(0, prev.x + dx),
          y: Math.max(0, prev.y + dy),
        }))
      }
    }

    const onMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, isElectronOverlay])

  // 表示テキストの選択（ストリーミング中は streamingText、完了後は answer）
  const displayText = hintData
    ? (hintData.isStreaming ? hintData.streamingText : hintData.answer)
    : null

  // ブラウザモードでは、ウィンドウ全体が 400x300 の popup なので
  // パネルを fixed 位置で動かす
  const panelPositionStyle: React.CSSProperties = isElectronOverlay
    ? { width: '100%', height: '100vh' }
    : {
        position: 'fixed',
        left: browserPos.x,
        top: browserPos.y,
        width: 380,
        maxHeight: '90vh',
      }

  return (
    <div
      className="overlay-container"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'transparent',
        fontFamily: "'Noto Sans JP', 'Yu Gothic', sans-serif",
      }}
    >
      <div
        className="overlay-panel"
        onMouseEnter={() => isElectronOverlay && window.overlayAPI!.setIgnoreMouse(false)}
        onMouseLeave={() => isElectronOverlay && window.overlayAPI!.setIgnoreMouse(true)}
        style={{
          ...panelPositionStyle,
          position: 'relative',
          background: 'rgba(10, 15, 30, 0.82)',
          border: '1px solid rgba(99, 179, 237, 0.4)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 全辺リサイズハンドル（Electronモードのみ） */}
        {isElectronOverlay && (['n','s','e','w','ne','nw','se','sw'] as const).map(dir => {
          const isCorner = dir.length === 2
          const cursorMap: Record<string, string> = { n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' }
          const s: React.CSSProperties = {
            position: 'absolute', zIndex: 10,
            ...(dir.includes('n') ? { top: 0 } : {}),
            ...(dir.includes('s') ? { bottom: 0 } : {}),
            ...(dir.includes('e') ? { right: 0 } : {}),
            ...(dir.includes('w') ? { left: 0 } : {}),
            ...(isCorner ? { width: 16, height: 16 } : dir === 'n' || dir === 's' ? { left: 16, right: 16, height: 10 } : { top: 16, bottom: 16, width: 10 }),
            cursor: cursorMap[dir],
          }
          return <div key={dir} style={s} onMouseDown={e => handleResizeStart(e, dir)} />
        })}

        {/* ドラッグハンドル兼ヘッダー */}
        <div
          onMouseDown={handleDragStart}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'rgba(30, 58, 138, 0.7)',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            borderBottom: '1px solid rgba(99, 179, 237, 0.3)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>💡</span>
            <span
              style={{
                color: '#93c5fd',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.05em',
              }}
            >
              ヒントパネル
            </span>
            {hintData?.isStreaming && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#34d399',
                  animation: 'pulse 1s infinite',
                  marginLeft: 4,
                }}
              />
            )}
          </div>

          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 文字色 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 10 }}>
              <span>文字色</span>
              <input
                type="color" value={textColor}
                onChange={e => setTextColor(e.target.value)}
                style={{ width: 24, height: 18, border: 'none', borderRadius: 3, cursor: 'pointer', background: 'none', padding: 0 }}
              />
            </label>

            {/* 透明度スライダー */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 10 }}>
              <span>透明度</span>
              <input
                type="range" min={0.2} max={1} step={0.05} value={windowOpacity}
                onChange={e => handleWindowOpacity(parseFloat(e.target.value))}
                style={{ width: 56, accentColor: '#6366f1', cursor: 'pointer' }}
              />
            </label>

            {/* バックエンド接続状態 */}
            <span style={{ fontSize: 9, color: backendReachable === true ? '#4ade80' : backendReachable === false ? '#f87171' : '#94a3b8' }}>
              {backendReachable === true ? '●接続OK' : backendReachable === false ? '●接続NG' : '●確認中'}
            </span>

            {/* 録音ボタン */}
            <button
              onClick={() => {
                console.log('[Overlay] 録音ボタン押された. isRecording=', isRecording, 'backendReachable=', backendReachable)
                isRecording ? stopElectronCapture() : startElectronCapture()
              }}
              style={{
                background: isRecording ? 'rgba(239, 68, 68, 0.5)' : 'rgba(34, 197, 94, 0.2)',
                border: `1px solid ${isRecording ? 'rgba(239, 68, 68, 0.7)' : 'rgba(34, 197, 94, 0.4)'}`,
                borderRadius: 4,
                color: isRecording ? '#fca5a5' : '#86efac',
                fontSize: 11,
                padding: '2px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title={isRecording ? '録音停止' : '録音開始'}
            >
              {isRecording ? (
                <>
                  <span style={{ width: 7, height: 7, borderRadius: 1, background: '#ef4444', display: 'inline-block' }} />
                  停止
                </>
              ) : (
                <>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                  録音
                </>
              )}
            </button>

            {/* キャプチャ状態表示 */}
            {captureStatus === 'no-audio' && (
              <span style={{ color: '#f87171', fontSize: 10 }}>音声なし</span>
            )}

            {/* 最小化ボタン */}
            <button
              onClick={() => setIsMinimized((v) => !v)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: 4,
                color: '#cbd5e1',
                fontSize: 11,
                padding: '2px 7px',
                cursor: 'pointer',
              }}
            >
              {isMinimized ? '▲' : '▼'}
            </button>

            {/* 閉じるボタン */}
            <button
              onClick={() => isElectronOverlay ? window.overlayAPI?.hide() : window.close()}
              style={{
                background: 'rgba(239, 68, 68, 0.3)',
                border: 'none',
                borderRadius: 4,
                color: '#fca5a5',
                fontSize: 11,
                padding: '2px 7px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* コンテンツ本体 */}
        {!isMinimized && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              minHeight: 0,
            }}
          >
            {/* ライブ文字起こし表示 */}
            {liveTranscript && (
              <div style={{
                background: 'rgba(99,179,237,0.08)',
                border: '1px solid rgba(99,179,237,0.2)',
                borderRadius: 6,
                padding: '6px 10px',
                marginBottom: 8,
                fontSize: 11,
                color: '#93c5fd',
                lineHeight: 1.5,
              }}>
                <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: 10 }}>音声認識中: </span>
                {liveTranscript}
              </div>
            )}

            {!hintData || (!hintData.question && !hintData.isStreaming) ? (
              /* 待機状態 */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '28px 12px',
                  gap: 8,
                  color: '#64748b',
                }}
              >
                <span style={{ fontSize: 28 }}>🎯</span>
                <p style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
                  {isRecording ? '音声を認識しています...' : '面接官の質問を話しかけてください'}
                </p>
                <p style={{ margin: 0, fontSize: 11, textAlign: 'center', color: '#475569' }}>
                  {isRecording ? 'Pythonがシステム音声を録音中' : '音声を認識するとここにヒントが表示されます'}
                </p>
              </div>
            ) : (
              /* ヒント表示 */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 検出された質問 */}
                {hintData.question && (
                  <div
                    style={{
                      background: 'rgba(30, 58, 138, 0.4)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      borderLeft: '3px solid #3b82f6',
                    }}
                  >
                    <p
                      style={{
                        margin: '0 0 3px',
                        fontSize: 10,
                        color: '#93c5fd',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                      }}
                    >
                      検出された質問
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: '#e2e8f0',
                        lineHeight: 1.5,
                      }}
                    >
                      {hintData.question}
                    </p>
                  </div>
                )}

                {/* 模範回答 */}
                {displayText && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 5px' }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 10,
                          color: '#86efac',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}
                      >
                        模範回答
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 10 }}>
                        <span>透明度</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={answerOpacity}
                          onChange={(e) => setAnswerOpacity(parseFloat(e.target.value))}
                          style={{ width: 50, accentColor: '#22c55e', cursor: 'pointer' }}
                        />
                      </label>
                    </div>
                    <div
                      style={{
                        background: 'rgba(5, 46, 22, 0.4)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        borderLeft: '3px solid #22c55e',
                        opacity: answerOpacity,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: textColor,
                          lineHeight: 1.7,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {displayText}
                        {hintData.isStreaming && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 2,
                              height: '1em',
                              background: '#22c55e',
                              marginLeft: 2,
                              animation: 'blink 0.8s step-end infinite',
                              verticalAlign: 'text-bottom',
                            }}
                          />
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSS アニメーション定義 */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        ::-webkit-scrollbar {
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(99, 179, 237, 0.4);
          border-radius: 2px;
        }
      `}</style>
    </div>
  )
}
