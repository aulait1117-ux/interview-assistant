import { useState, useEffect, useRef, useCallback } from 'react'

/** メインアプリから受け取るヒントデータ */
interface OverlayHintData {
  question: string
  answer: string
  isStreaming: boolean
  streamingText: string
}

/** overlayAPI の型定義（window に注入される） */
declare global {
  interface Window {
    overlayAPI?: {
      hide: () => void
      moveWindow: (dx: number, dy: number) => void
      setOpacity: (opacity: number) => void
      getPosition: () => Promise<{ x: number; y: number }>
      onHintsUpdated: (cb: (data: OverlayHintData) => void) => () => void
      isElectron: boolean
      isOverlay: boolean
      platform: string
    }
  }
}

export default function OverlayApp() {
  const [hintData, setHintData] = useState<OverlayHintData | null>(null)
  const [opacity, setOpacity] = useState(0.88)
  const [isMinimized, setIsMinimized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  // ドラッグ用 ref
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0 })

  // メインアプリからのヒント受信
  useEffect(() => {
    const api = window.overlayAPI
    if (!api) return
    const unsubscribe = api.onHintsUpdated((data) => {
      setHintData(data)
      // 新しい質問が来たら自動展開
      if (data.question) setIsMinimized(false)
    })
    return unsubscribe
  }, [])

  // 透明度の変更
  useEffect(() => {
    window.overlayAPI?.setOpacity(opacity)
  }, [opacity])

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
      window.overlayAPI?.moveWindow(dx, dy)
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
  }, [isDragging])

  // 表示テキストの選択（ストリーミング中は streamingText、完了後は answer）
  const displayText = hintData
    ? (hintData.isStreaming ? hintData.streamingText : hintData.answer)
    : null

  return (
    <div
      className="overlay-container"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        background: 'transparent',
        fontFamily: "'Noto Sans JP', 'Yu Gothic', sans-serif",
      }}
    >
      <div
        className="overlay-panel"
        style={{
          width: '100%',
          maxHeight: '100vh',
          background: 'rgba(10, 15, 30, 0.82)',
          border: '1px solid rgba(99, 179, 237, 0.4)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
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
            {/* 透明度スライダー */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#94a3b8',
                fontSize: 11,
              }}
            >
              <span>透明度</span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                style={{ width: 56, accentColor: '#60a5fa', cursor: 'pointer' }}
              />
            </label>

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
              onClick={() => window.overlayAPI?.hide()}
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
                  面接官の質問を話しかけてください
                </p>
                <p style={{ margin: 0, fontSize: 11, textAlign: 'center', color: '#475569' }}>
                  音声を認識するとここにヒントが表示されます
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
                    <p
                      style={{
                        margin: '0 0 5px',
                        fontSize: 10,
                        color: '#86efac',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                      }}
                    >
                      模範回答
                    </p>
                    <div
                      style={{
                        background: 'rgba(5, 46, 22, 0.4)',
                        borderRadius: 8,
                        padding: '10px 12px',
                        borderLeft: '3px solid #22c55e',
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: '#dcfce7',
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
