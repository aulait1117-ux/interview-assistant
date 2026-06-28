// Electron環境でのみ表示されるカスタムタイトルバー
// ブラウザ環境では何も表示しない（window.electronAPI の存在で判別）
import { useState, useEffect } from 'react'

interface TitleBarProps {
  onCollapse?: () => void
}

declare global {
  interface Window {
    electronAPI?: {
      minimize?: () => void
      close?: () => void
      setOpacity?: (opacity: number) => void
      expand?: () => void
      collapse?: () => void
      isElectron?: boolean
    }
  }
}

const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// Electron環境なら body に electron-env クラスを付与（CSS で透明背景が適用される）
if (isElectron) {
  document.body.classList.add('electron-env')
}

const OPACITY_STORAGE_KEY = 'titlebar-opacity'
const DEFAULT_OPACITY = 100

export default function TitleBar({ onCollapse }: TitleBarProps = {}) {
  const [opacity, setOpacity] = useState<number>(() => {
    const saved = localStorage.getItem(OPACITY_STORAGE_KEY)
    return saved ? Number(saved) : DEFAULT_OPACITY
  })

  // 初回マウント時に保存済みの透明度を適用
  useEffect(() => {
    if (isElectron && window.electronAPI?.setOpacity) {
      window.electronAPI.setOpacity(opacity / 100)
    }
  }, [])

  // Electron環境でない場合は何も表示しない
  if (!isElectron) {
    return null
  }

  const handleMinimize = () => {
    window.electronAPI?.minimize?.()
  }

  const handleClose = () => {
    window.electronAPI?.close?.()
  }

  const handleCollapse = () => {
    window.electronAPI?.collapse?.()
    onCollapse?.()
  }

  const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value)
    setOpacity(value)
    localStorage.setItem(OPACITY_STORAGE_KEY, String(value))
    window.electronAPI?.setOpacity?.(value / 100)
  }

  return (
    <div className="title-bar">
      <div className="title-bar-drag" />
      <div className="opacity-control">
        <span className="opacity-label">透明度</span>
        <input
          type="range"
          className="opacity-slider"
          min={10}
          max={100}
          step={5}
          value={opacity}
          onChange={handleOpacityChange}
        />
        <span className="opacity-value">{opacity}%</span>
      </div>
      <div className="title-bar-buttons">
        <button
          className="title-bar-btn title-bar-collapse"
          onClick={handleCollapse}
          title="縮小"
          style={{ fontSize: '10px', padding: '2px 6px' }}
        >
          縮小
        </button>
        <button
          className="title-bar-btn title-bar-minimize"
          onClick={handleMinimize}
          title="最小化"
        >
          &#x2212;
        </button>
        <button
          className="title-bar-btn title-bar-close"
          onClick={handleClose}
          title="閉じる"
        >
          &#x2715;
        </button>
      </div>
    </div>
  )
}
