import { useRef, useCallback } from 'react'

/** オーバーレイウィンドウ送信データ */
export interface OverlayHintPayload {
  question: string
  answer: string
  isStreaming: boolean
  streamingText: string
}

/** BroadcastChannel でヒントを送信するユーティリティ */
export function sendHintToOverlay(payload: OverlayHintPayload): void {
  try {
    const channel = new BroadcastChannel('overlay-channel')
    channel.postMessage({ type: 'hint', data: payload })
    // 送信後すぐ閉じる（各呼び出しで使い捨て）
    channel.close()
  } catch (e) {
    console.warn('BroadcastChannel send failed:', e)
  }
}

interface OverlayButtonProps {
  /** ボタンの追加クラス名 */
  className?: string
}

/**
 * ブラウザモード用オーバーレイボタン
 * - Electron 環境では Electron IPC の toggleOverlay を使用
 * - ブラウザ環境では window.open で /overlay.html を開く
 */
export default function OverlayButton({ className }: OverlayButtonProps) {
  const overlayWindowRef = useRef<Window | null>(null)

  const handleClick = useCallback(() => {
    // Electron 環境では Electron の IPC を使う
    if (window.electronAPI?.isElectron) {
      window.electronAPI.toggleOverlay()
      return
    }

    // ブラウザ環境: すでに開いていれば閉じる、なければ開く
    if (overlayWindowRef.current && !overlayWindowRef.current.closed) {
      overlayWindowRef.current.close()
      overlayWindowRef.current = null
      return
    }

    const features = [
      'width=400',
      'height=520',
      'left=100',
      'top=100',
      'resizable=yes',
      'scrollbars=no',
      'toolbar=no',
      'menubar=no',
      'location=no',
      'status=no',
    ].join(',')

    const win = window.open('/overlay.html', 'interview-overlay', features)
    overlayWindowRef.current = win
  }, [])

  return (
    <button
      className={className ?? 'feedback-btn'}
      style={{ fontSize: 12 }}
      onClick={handleClick}
      title="別ウィンドウにヒントパネルを表示（Zoom等の上にも重ねられます）"
    >
      💡 オーバーレイ
    </button>
  )
}
