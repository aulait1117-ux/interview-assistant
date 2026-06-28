import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Electronビルド時は相対パス（base: './'）を使用
// 通常のブラウザ開発時は '/' のまま
const isElectronBuild = process.env.ELECTRON_BUILD === 'true'
const apiUrl = process.env.VITE_API_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  base: isElectronBuild ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': apiUrl,
    },
  },
  build: {
    outDir: 'dist',
    // マルチエントリー: メインアプリ + オーバーレイウィンドウ
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
      output: {
        // チャンク分割設定（Electron用）
        manualChunks: undefined,
      },
    },
  },
})