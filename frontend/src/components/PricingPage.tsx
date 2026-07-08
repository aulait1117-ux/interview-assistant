import { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../hooks/useAuth'

interface Plan {
  id: string
  name: string
  price: number
  minutes: number
  label: string
}

interface Props {
  onBack: () => void
}

// プランごとの追加情報（お得感・バッジ・説明文）
const PLAN_META: Record<string, {
  icon: string
  tagline: string
  badge?: string
  badgeColor?: string
  savings?: string
  perDay?: string
  highlight?: boolean
  accent?: string
}> = {
  free: {
    icon: '🎁',
    tagline: 'まずは無料で試してみよう',
    accent: 'var(--border)',
  },
  day1h: {
    icon: '⏱️',
    tagline: '今日の面接前にサクッと対策',
    savings: '1時間でも本番対策に十分',
    accent: '#0ea5e9',
  },
  day24h: {
    icon: '🌞',
    tagline: '丸一日、面接対策し放題',
    badge: 'コスパ◎',
    badgeColor: '#0ea5e9',
    savings: '1日プランで感覚をつかもう',
    perDay: '1日あたり¥1,000',
    accent: '#0ea5e9',
  },
  monthly: {
    icon: '🚀',
    tagline: '就活期間を完全サポート',
    badge: '🏆 コスパ最強・一番お得',
    badgeColor: '#16a34a',
    savings: '1日プランを毎日使うより¥28,000お得！',
    perDay: '1日あたり約¥65',
    highlight: true,
    accent: 'var(--primary)',
  },
  monthly_discount: {
    icon: '🎉',
    tagline: '1日プラン経験者限定の特別割引',
    badge: '50%OFF',
    badgeColor: '#ef4444',
    savings: '通常¥2,000→¥1,000に半額！',
    perDay: '1日あたり約¥32',
    highlight: true,
    accent: '#ef4444',
  },
}

interface SubStatus {
  has_subscription: boolean
  status: string | null
  cancel_at_period_end: boolean
  plan: string | null
  plan_expires_at: string | null
}

export default function PricingPage({ onBack }: Props) {
  const { user, refreshUser } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<string>('stripe_card')
  const [sub, setSub] = useState<SubStatus | null>(null)
  const [subBusy, setSubBusy] = useState(false)

  useEffect(() => {
    axios.get<Plan[]>('/api/billing/plans').then(r => setPlans(r.data))
  }, [])

  const loadSubscription = () => {
    if (!user) { setSub(null); return }
    axios.get<SubStatus>('/api/billing/subscription').then(r => setSub(r.data)).catch(() => setSub(null))
  }
  useEffect(loadSubscription, [user])

  const formatDate = (iso: string | null) => {
    if (!iso) return ''
    const d = new Date(iso.replace(' ', 'T'))
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  const handleCancel = async () => {
    if (!window.confirm('自動更新を停止しますか？\n現在の期間の満了日までは引き続きご利用いただけます。')) return
    setSubBusy(true)
    try {
      await axios.post('/api/billing/subscription/cancel')
      loadSubscription()
      await refreshUser()
    } catch (err: any) {
      alert(err.response?.data?.detail || '解約処理でエラーが発生しました')
    } finally {
      setSubBusy(false)
    }
  }

  const handleResume = async () => {
    setSubBusy(true)
    try {
      await axios.post('/api/billing/subscription/resume')
      loadSubscription()
      await refreshUser()
    } catch (err: any) {
      alert(err.response?.data?.detail || '再開処理でエラーが発生しました')
    } finally {
      setSubBusy(false)
    }
  }

  const handleCheckout = async (planId: string) => {
    setIsLoading(true)
    setCheckoutError(null)
    try {
      const res = await axios.post<{ checkout_url: string }>('/api/billing/checkout', {
        plan: planId,
        provider: selectedProvider,
      })
      window.location.href = res.data.checkout_url
    } catch (err: any) {
      const msg = err.response?.data?.detail || '決済エラーが発生しました'
      setCheckoutError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const FREE_PLAN: Plan = { id: 'free', name: '無料トライアル', price: 0, minutes: 30, label: '無料トライアル' }

  const allPlans: Plan[] = [FREE_PLAN, ...plans]

  return (
    <div className="pricing-page">
      <header className="mode-header">
        <button className="back-btn" onClick={onBack}>← 戻る</button>
        <h1 className="pricing-title">料金プラン</h1>
      </header>

      <div className="pricing-body">
        {/* 自動更新サブスクの契約管理パネル（契約中のみ表示） */}
        {sub?.has_subscription && (
          <div className="subscription-panel">
            <div className="subscription-panel-head">
              <span className="subscription-panel-title">🔁 月額プラン（自動更新）ご契約中</span>
              <span className={`subscription-status-tag ${sub.status === 'past_due' ? 'past-due' : sub.cancel_at_period_end ? 'canceling' : 'active'}`}>
                {sub.status === 'past_due' ? '決済失敗（要確認）' : sub.cancel_at_period_end ? '解約予約済み' : '有効'}
              </span>
            </div>
            <p className="subscription-panel-body">
              {sub.cancel_at_period_end ? (
                <>自動更新は停止済みです。<strong>{formatDate(sub.plan_expires_at)}</strong>まで利用でき、以降は無料プランに戻ります。</>
              ) : (
                <>次回更新日は<strong>{formatDate(sub.plan_expires_at)}</strong>です。以降、解約されるまで31日ごとに自動で更新・課金されます。</>
              )}
            </p>
            <div className="subscription-panel-actions">
              {sub.cancel_at_period_end ? (
                <button className="btn-sub-resume" onClick={handleResume} disabled={subBusy}>
                  {subBusy ? '処理中...' : '自動更新を再開する'}
                </button>
              ) : (
                <button className="btn-sub-cancel" onClick={handleCancel} disabled={subBusy}>
                  {subBusy ? '処理中...' : '自動更新を停止（解約）する'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 1日プラン購入者向け割引バナー */}
        <div className="day-plan-discount-banner">
          <div className="discount-banner-icon">🎉</div>
          <div className="discount-banner-text">
            <strong>1日プランを購入したことがある方は月額プランが¥1,000 OFF！</strong>
            <span className="discount-banner-sub">通常¥2,000 → 特別価格¥1,000（50%OFF）でご利用いただけます</span>
          </div>
          <div className="discount-banner-tag">対象者限定</div>
        </div>

        <div className="pricing-hero">
          <p className="pricing-hero-title">就活生応援価格で、面接対策をもっと気軽に</p>
          <p className="pricing-subtitle">無料から始めて、必要に応じてアップグレード。すべてのプランで全機能が使えます。</p>
        </div>

        {/* 比較ハイライト */}
        <div className="pricing-compare-bar">
          <div className="compare-item">
            <span className="compare-icon">🎓</span>
            <span>学生向け特別価格</span>
          </div>
          <div className="compare-divider" />
          <div className="compare-item">
            <span className="compare-icon">⚡</span>
            <span>即時利用開始</span>
          </div>
          <div className="compare-divider" />
          <div className="compare-item">
            <span className="compare-icon">🔒</span>
            <span>安全な決済</span>
          </div>
          <div className="compare-divider" />
          <div className="compare-item">
            <span className="compare-icon">🎯</span>
            <span>全機能使い放題</span>
          </div>
        </div>

        {checkoutError && (
          <div style={{ color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 16px', fontSize: 14, marginBottom: 16 }}>
            ⚠️ {checkoutError}
          </div>
        )}

        <div className="pricing-grid">
          {allPlans.map(plan => {
            const meta = PLAN_META[plan.id] || { icon: '📋', tagline: '', accent: 'var(--border)' }
            const isCurrent = user?.plan === plan.id
            const isHighlight = meta.highlight

            return (
              <div
                key={plan.id}
                className={`plan-card${isHighlight ? ' featured' : ''}${plan.id === 'free' ? ' free' : ''}`}
                style={{ '--plan-accent': meta.accent } as React.CSSProperties}
              >
                {/* バッジ */}
                {meta.badge && (
                  <div
                    className="popular-badge"
                    style={{ background: meta.badgeColor || 'var(--primary)' }}
                  >
                    {meta.badge}
                  </div>
                )}

                <div className="plan-icon">{meta.icon}</div>
                <div className="plan-name">{plan.name}</div>

                {/* 価格表示 */}
                <div className="plan-price-block">
                  {plan.price === 0 ? (
                    <div className="plan-price free-price">¥0</div>
                  ) : (
                    <>
                      <div className="plan-price">
                        <span className="plan-price-currency">¥</span>
                        <span className="plan-price-num">{plan.price.toLocaleString()}</span>
                      </div>
                      {meta.perDay && (
                        <div className="plan-per-day">{meta.perDay}</div>
                      )}
                    </>
                  )}
                </div>

                {/* 利用期間 */}
                <div className="plan-duration">
                  {plan.id === 'free' && '30分間お試し'}
                  {plan.id === 'day1h' && '24時間有効・1時間まで'}
                  {plan.id === 'day24h' && '24時間有効・使い放題'}
                  {(plan.id === 'monthly' || plan.id === 'monthly_discount') && '31日ごとに自動更新・使い放題'}
                </div>

                {/* タグライン */}
                <div className="plan-tagline">{meta.tagline}</div>

                {/* お得情報 */}
                {meta.savings && (
                  <div className="plan-savings">
                    <span className="savings-icon">✨</span>
                    {meta.savings}
                  </div>
                )}

                {/* 機能一覧 */}
                <div className="plan-features">
                  <p>✓ リアルタイム面接補助</p>
                  <p>✓ 企業情報自動調査</p>
                  {plan.id !== 'free' && <p>✓ 模擬面接モード</p>}
                  {plan.id !== 'free' && <p>✓ 履歴・総評保存</p>}
                  {plan.id === 'monthly_discount' && <p>✓ 1日プラン経験者限定特典</p>}
                </div>

                {/* 1日プラン購入者向け割引案内（月額プランのみ） */}
                {plan.id === 'monthly' && (
                  <div className="monthly-day-discount-note">
                    <span className="day-discount-icon">🏷️</span>
                    <span>1日プラン購入者は<strong>¥1,000引き</strong>で利用可能！</span>
                  </div>
                )}

                {/* 自動更新の事前明示（月額プランのみ・購入前告知） */}
                {(plan.id === 'monthly' || plan.id === 'monthly_discount') && (
                  <div className="plan-autorenew-note">
                    🔁 31日ごとに自動更新（自動継続課金）。カード決済のみ。マイページからいつでも解約でき、解約後も期間満了日まで利用可能です。
                  </div>
                )}

                {/* CTAボタン */}
                {isCurrent ? (
                  <div className="current-plan-badge">✓ 現在のプラン</div>
                ) : plan.id === 'free' ? (
                  <div className="plan-free-note">登録するだけで利用開始</div>
                ) : (
                  <button
                    className={`btn-purchase${isHighlight ? ' btn-purchase-featured' : ''}`}
                    onClick={() => handleCheckout(plan.id)}
                    disabled={isLoading}
                  >
                    {isLoading ? '処理中...' : (
                      <>
                        {plan.id === 'monthly_discount' ? '割引価格で始める' : 'このプランにする'}
                        <span className="btn-arrow">→</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* 月額プランのコスト比較 */}
        <div className="pricing-value-section">
          <div className="value-card">
            <div className="value-card-title">🏆 月額プランがダントツお得</div>
            <div className="value-card-subtitle">就活期間中ずっと使うなら月額一択！</div>
            <div className="value-comparison">
              <div className="value-item">
                <div className="value-label">1日プランを毎日使うと</div>
                <div className="value-price bad">¥30,000<span className="value-unit">/月</span></div>
                <div className="value-note">（¥1,000 × 30日）</div>
              </div>
              <div className="value-vs">VS</div>
              <div className="value-item highlight-item">
                <div className="value-label">月額プランなら</div>
                <div className="value-price good">¥2,000<span className="value-unit">/月</span></div>
                <div className="value-saving">💰 約¥28,000お得！</div>
                <div className="value-note">1日プラン経験者はさらに¥1,000引き</div>
              </div>
            </div>
          </div>
        </div>

        {/* 決済方法 */}
        <div className="payment-methods">
          <p className="payment-label">決済方法を選択</p>
          <div className="payment-options">
            {/* Stripe（即時利用可） */}
            <button
              className={`payment-opt ${selectedProvider === 'stripe_card' ? 'active' : ''}`}
              onClick={() => setSelectedProvider('stripe_card')}
            >
              💳 カード / Apple Pay / Google Pay
            </button>
            <button
              className={`payment-opt ${selectedProvider === 'stripe_konbini' ? 'active' : ''}`}
              onClick={() => setSelectedProvider('stripe_konbini')}
            >
              🏪 コンビニ払い
              <span className="payment-opt-note">ローソン・ファミマ・ミニストップ 他</span>
            </button>
            {/* PayPay */}
            <button
              className={`payment-opt ${selectedProvider === 'paypay' ? 'active' : ''}`}
              onClick={() => setSelectedProvider('paypay')}
            >
              🟡 PayPay
            </button>
            {/* LINE Pay（準備中） */}
            <button className="payment-opt coming-soon" disabled>
              💚 LINE Pay
              <span className="payment-opt-badge">準備中</span>
            </button>
            {/* Amazon Pay（準備中） */}
            <button className="payment-opt coming-soon" disabled>
              📦 Amazon Pay
              <span className="payment-opt-badge">準備中</span>
            </button>
            {/* d払い（準備中） */}
            <button className="payment-opt coming-soon" disabled>
              📱 d払い
              <span className="payment-opt-badge">準備中</span>
            </button>
            {/* au PAY（準備中） */}
            <button className="payment-opt coming-soon" disabled>
              🔵 au PAY
              <span className="payment-opt-badge">準備中</span>
            </button>
          </div>
          {selectedProvider === 'stripe_konbini' && (
            <p className="payment-konbini-note">
              ⚠️ コンビニ払いは発行から3日以内にお支払いください。支払い確認後にプランが有効になります。
            </p>
          )}
        </div>

        <div className="pricing-notes">
          <p>✓ Stripe・PayPayによる安全な決済</p>
          <p>✓ 1日プランは購入から24時間有効（自動更新なし・都度購入）</p>
          <p>✓ <strong>月額プランは31日ごとに自動更新（自動継続課金）</strong>。カード決済のみ・マイページからいつでも解約でき、解約後も期間満了日まで利用できます</p>
          <p>✓ 自動更新の停止（解約）後、日割りでの返金は行いません（特定商取引法に基づく表記をご確認ください）</p>
          <p>✓ 1日プランを一度でも購入すると月額が<strong>¥1,000</strong>に割引（通常¥2,000）</p>
        </div>
      </div>
    </div>
  )
}
