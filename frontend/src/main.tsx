import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import axios from 'axios'
import './index.css'
import App from './App.tsx'

// 本番環境（Railway等）では VITE_API_URL を設定することでバックエンドURLを切り替える
// 開発環境ではvite.config.tsのproxyが /api を localhost:8000 に転送するため空文字でOK
axios.defaults.baseURL = import.meta.env.VITE_API_URL || ''

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
)
