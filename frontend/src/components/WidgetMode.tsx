/**
 * WidgetMode.tsx
 * コンパクト表示用ウィジェットUI。
 * クリックで electronAPI.expand() を呼び出し、通常サイズに展開する。
 */

// Electron の CSS プロパティ拡張（-webkit-app-region）
type ElectronCSSProperties = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag'
}

interface WidgetModeProps {
  onExpand: () => void
}

export default function WidgetMode({ onExpand }: WidgetModeProps) {
  const handleExpand = () => {
    if (window.electronAPI?.expand) {
      window.electronAPI.expand()
    }
    onExpand()
  }

  const containerStyle: ElectronCSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
    borderRadius: '12px',
    border: '1px solid rgba(59, 130, 246, 0.4)',
    boxSizing: 'border-box',
    WebkitAppRegion: 'drag',
    cursor: 'grab',
    userSelect: 'none',
    overflow: 'hidden',
  }

  const labelStyle: ElectronCSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#e2e8f0',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
    WebkitAppRegion: 'drag',
  }

  const buttonStyle: ElectronCSSProperties = {
    WebkitAppRegion: 'no-drag',
    background: 'rgba(59, 130, 246, 0.85)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.03em',
    transition: 'background 0.15s',
    flexShrink: 0,
  }

  return (
    <div style={containerStyle}>
      {/* ロゴ＋タイトル */}
      <div style={labelStyle}>
        <span style={{ fontSize: '16px', lineHeight: 1 }}>🎯</span>
        <span>面接アシスタント</span>
      </div>

      {/* 開くボタン（ドラッグ領域から除外） */}
      <button
        onClick={handleExpand}
        style={buttonStyle}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(37, 99, 235, 1)'
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59, 130, 246, 0.85)'
        }}
      >
        開く
      </button>
    </div>
  )
}
