import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { InterviewType, AppMode, UserProfile } from './types'
import { AuthContext, useAuthProvider } from './hooks/useAuth'
import HomePage from './components/HomePage'
import SetupForm from './components/SetupForm'
import RealtimeMode from './components/RealtimeMode'
import AuthModal from './components/AuthModal'
import PricingPage from './components/PricingPage'
import AppHeader from './components/AppHeader'
import TitleBar from './components/TitleBar'
import WidgetMode from './components/WidgetMode'

interface SessionState {
  sessionId: string
  interviewType: InterviewType
  profile: UserProfile
  mode: 'realtime'
}

export default function App() {
  const auth = useAuthProvider()
  const [appMode, setAppMode] = useState<AppMode>('home')
  const [selectedType] = useState<InterviewType>('面接アシスト')
  const [session, setSession] = useState<SessionState | null>(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showPricing, setShowPricing] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('plan')
  })
  // Electron環境では起動時にウィジェット（コンパクト）モードで開始する
  const [isCompact, setIsCompact] = useState<boolean>(
    () => !!(typeof window !== 'undefined' && window.electronAPI?.isElectron)
  )

  // アプリ起動中ずっと60秒ごとに使用時間を記録（無料・短期プランのみ、管理者は除外）
  const { user, refreshUser } = auth
  const hasTimeLimit = user != null && !user.is_admin && user.minutes_limit < 60 * 24

  const trackUsage = useCallback(async () => {
    try {
      await axios.post('/api/billing/track-usage', null, { params: { minutes: 1 } })
      await refreshUser()
    } catch (e) {
      console.error('track-usage failed:', e)
    }
  }, [refreshUser])

  useEffect(() => {
    if (!hasTimeLimit) return
    const interval = setInterval(trackUsage, 60 * 1000)
    return () => clearInterval(interval)
  }, [hasTimeLimit, trackUsage])

  const handleStart = async (profile: UserProfile) => {
    const background = buildBackground(profile)
    try {
      const res = await axios.post<{ session_id: string }>('/api/interview/session', {
        interview_type: selectedType,
        user_background: background,
      })
      setSession({ sessionId: res.data.session_id, interviewType: selectedType, profile, mode: 'realtime' })
      setAppMode('realtime')
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setShowAuthModal(true)
      } else {
        alert('バックエンドに接続できませんでした。サーバーが起動しているか確認してください。')
        console.error('handleStart error:', err)
      }
    }
  }

  const handleBack = () => {
    setAppMode('setup')
    setSession(null)
  }

  // 決済完了後のプラン有効化
  useEffect(() => {
    if (!paymentSuccess || !auth.user) return
    axios.post('/api/billing/payment/success', null, { params: { plan: paymentSuccess } })
      .then(() => auth.refreshUser())
      .catch(() => {})
    window.history.replaceState({}, '', window.location.pathname)
  }, [paymentSuccess, auth.user])

  if (auth.isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#94a3b8' }}>
        読み込み中...
      </div>
    )
  }

  if (paymentSuccess) {
    const PLAN_NAMES: Record<string, string> = {
      day1h: '1日1時間プラン',
      day24h: '1日使い放題プラン',
      monthly: '月額使い放題プラン',
      monthly_discount: '月額プラン（割引）',
    }
    return (
      <AuthContext.Provider value={auth}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, color: '#e2e8f0', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 64 }}>🎉</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>決済完了！</h1>
          <p style={{ color: '#94a3b8', margin: 0 }}>{PLAN_NAMES[paymentSuccess] ?? paymentSuccess} が有効になりました</p>
          <button
            onClick={() => setPaymentSuccess(null)}
            style={{ marginTop: 8, padding: '10px 28px', background: 'var(--primary, #6366f1)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}
          >
            アプリに戻る
          </button>
        </div>
      </AuthContext.Provider>
    )
  }

  const handleHome = () => {
    setAppMode('home')
    setSession(null)
    setShowPricing(false)
  }

  const handleExpand = () => {
    setIsCompact(false)
  }

  const handleCollapse = () => {
    setIsCompact(true)
  }

  // ウィジェットモード（コンパクト表示）
  if (isCompact) {
    return <WidgetMode onExpand={handleExpand} />
  }

  return (
    <AuthContext.Provider value={auth}>
      <TitleBar onCollapse={handleCollapse} />
      <AppHeader
        onLogin={() => setShowAuthModal(true)}
        onPricing={() => setShowPricing(true)}
        onHome={handleHome}
      />

      {showPricing ? (
        <PricingPage onBack={() => setShowPricing(false)} />
      ) : appMode === 'home' ? (
        <HomePage
          onStart={() => setAppMode('setup')}
          onPricing={() => setShowPricing(true)}
          onLogin={() => setShowAuthModal(true)}
        />
      ) : appMode === 'setup' ? (
        <SetupForm
          onStart={handleStart}
          onBack={() => setAppMode('home')}
        />
      ) : appMode === 'realtime' && session ? (
        <RealtimeMode
          sessionId={session.sessionId}
          interviewType={session.interviewType}
          userBackground={buildBackground(session.profile)}
          onBack={handleBack}
          onShowPricing={() => setShowPricing(true)}
        />
      ) : null}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </AuthContext.Provider>
  )
}

function buildBackground(p: UserProfile): string {
  const parts: string[] = []
  if (p.name) parts.push(`名前: ${p.name}`)
  if (p.university) parts.push(`大学: ${p.university}`)
  if (p.faculty) parts.push(`学部: ${p.faculty}`)
  if (p.grade) parts.push(`学年: ${p.grade}`)
  if (p.strength) parts.push(`強み: ${p.strength}`)
  if (p.experience) parts.push(`ガクチカ: ${p.experience}`)
  if (p.companyName) parts.push(`志望先: ${p.companyName}`)
  if (p.industry) parts.push(`業界/分野: ${p.industry}`)
  if (p.jobType) parts.push(`職種/テーマ: ${p.jobType}`)
  if (p.motivation) parts.push(`志望理由: ${p.motivation}`)
  return parts.join('\n')
}
