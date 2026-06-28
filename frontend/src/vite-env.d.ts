/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Window.electronAPI の統一型定義（TitleBar.tsx と RealtimeMode.tsx で共通利用）
interface ElectronAPI {
  expand: () => void
  collapse: () => void
  minimize: () => void
  close: () => void
  hide: () => void
  show: () => void
  toggleAlwaysOnTop: () => void
  moveWindow: (dx: number, dy: number) => void
  getPosition: () => Promise<{ x: number; y: number }>
  getSize: () => Promise<{ width: number; height: number }>
  setSize: (w: number, h: number) => void
  setOpacity: (opacity: number) => void
  onAlwaysOnTopChanged: (cb: (val: boolean) => void) => () => void
  sendHintsToOverlay: (data: {
    question: string
    answer: string
    isStreaming: boolean
    streamingText: string
  }) => void
  toggleOverlay: () => void
  showOverlay: () => void
  hideOverlay: () => void
  isElectron: boolean
  platform: string
}

interface Window {
  electronAPI?: ElectronAPI
}

