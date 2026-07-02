// Electron環境でのみ表示されるカスタムタイトルバー
// ブラウザ環境では何も表示しない（window.electronAPI の存在で判別）

interface TitleBarProps {
  onCollapse?: () => void
}


const isElectron = typeof window !== 'undefined' && !!window.electronAPI

// Electron環境なら body に electron-env クラスを付与（CSS で透明背景が適用される）
if (isElectron) {
  document.body.classList.add('electron-env')
}

export default function TitleBar({ onCollapse }: TitleBarProps = {}) {

  // Electron環境でない場合は何も表示しない
  if (!isElectron) {
    return null
  }

  const handleMinimize = () => {
    window.electronAPI?.minimize?.()
  }

  const handleMaximize = () => {
    window.electronAPI?.maximize?.()
  }

  const handleClose = () => {
    window.electronAPI?.close?.()
  }

  const handleCollapse = () => {
    window.electronAPI?.collapse?.()
    onCollapse?.()
  }

  return (
    <div className="title-bar">
      <div className="title-bar-drag" />
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
          className="title-bar-btn title-bar-maximize"
          onClick={handleMaximize}
          title="最大化"
        >
          &#x25A1;
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
