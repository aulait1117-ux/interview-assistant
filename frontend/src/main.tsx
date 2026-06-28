import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.tsx'

// 本番環境（Railway等）では VITE_API_URL を設定することでバックエンドURLを切り替える
// 開発環境ではvite.config.tsのproxyが /api を localhost:8000 に転送するため空文字でOK
axios.defaults.baseURL = import.meta.env.VITE_API_URL || ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
