import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { UserProfile } from '../types'

interface CompanyInfo {
  overview: string
  business: string
  culture: string
  strengths: string
  recent_topics: string
  interview_tips: string
  review_summary?: string
  sources?: { title: string; url: string }[]
  review_sources?: { title: string; url: string }[]
}

interface Props {
  onStart: (profile: UserProfile) => void
  onBack: () => void
}

const GRADE_OPTIONS = ['大学1年', '大学2年', '大学3年', '大学4年', '大学院1年', '大学院2年', 'その他']

const STORAGE_KEY = 'interview_setup_profile'
const COMPANY_HISTORY_KEY = 'interview_company_history'
const URL_STORAGE_KEY = 'interview_company_urls'
const MAX_HISTORY = 10

function loadUrlsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(URL_STORAGE_KEY)
    if (saved) return JSON.parse(saved) as string[]
  } catch {}
  return ['', '']
}

const INTERVIEW_TYPE_OPTIONS = ['1次面接', '2次面接', '最終面接', 'グループディスカッション', 'その他']

const EMPTY_PROFILE: UserProfile = {
  name: '', university: '', faculty: '', grade: '大学3年',
  strength: '', experience: '',
  companyName: '', industry: '', jobType: '', motivation: '',
  jobTitle: '', interviewTypePref: '1次面接',
}

function loadProfileFromStorage(): UserProfile {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<UserProfile>
      return { ...EMPTY_PROFILE, ...parsed }
    }
  } catch {
    // 読み込み失敗時はデフォルト値を使用
  }
  return EMPTY_PROFILE
}

function loadHistoryFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(COMPANY_HISTORY_KEY)
    if (saved) return JSON.parse(saved) as string[]
  } catch {
    // ignore
  }
  return []
}

function saveHistoryToStorage(history: string[]) {
  try {
    localStorage.setItem(COMPANY_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // ignore
  }
}

function addToHistory(history: string[], value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return history
  const filtered = history.filter(h => h !== trimmed)
  return [trimmed, ...filtered].slice(0, MAX_HISTORY)
}

// 履歴ドロップダウンコンポーネント
interface HistoryDropdownProps {
  history: string[]
  onSelect: (value: string) => void
  onDelete: (value: string) => void
  onClearAll: () => void
}

function HistoryDropdown({ history, onSelect, onDelete, onClearAll }: HistoryDropdownProps) {
  if (history.length === 0) return null
  return (
    <div className="history-dropdown">
      <div className="history-header">
        <span className="history-title">履歴</span>
        <button
          className="history-clear-all"
          onClick={e => { e.preventDefault(); e.stopPropagation(); onClearAll() }}
          type="button"
        >
          すべて削除
        </button>
      </div>
      <ul className="history-list">
        {history.map(item => (
          <li key={item} className="history-item">
            <button
              className="history-item-select"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onSelect(item) }}
              type="button"
            >
              {item}
            </button>
            <button
              className="history-item-delete"
              onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(item) }}
              type="button"
              aria-label={`${item}を削除`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SetupForm({ onStart, onBack }: Props) {
  const [profile, setProfile] = useState<UserProfile>(loadProfileFromStorage)
  const [step, setStep] = useState<'user' | 'company'>('user')
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null)
  const [isResearching, setIsResearching] = useState(false)
  const [urls, setUrls] = useState<string[]>(loadUrlsFromStorage)

  // 履歴の状態
  const [history, setHistory] = useState<string[]>(loadHistoryFromStorage)
  const [showHistory, setShowHistory] = useState(false)
  const companyInputRef = useRef<HTMLDivElement>(null)

  // profileが変わるたびにlocalStorageへ保存
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
    } catch {
      // ストレージ書き込み失敗は無視
    }
  }, [profile])

  // 履歴が変わるたびにlocalStorageへ保存
  useEffect(() => {
    saveHistoryToStorage(history)
  }, [history])

  // URLが変わるたびにlocalStorageへ保存
  useEffect(() => {
    try {
      localStorage.setItem(URL_STORAGE_KEY, JSON.stringify(urls))
    } catch {}
  }, [urls])

  // 外側クリックで履歴を閉じる
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (companyInputRef.current && !companyInputRef.current.contains(e.target as Node)) {
      setShowHistory(false)
    }
  }, [])

  useEffect(() => {
    if (showHistory) {
      document.addEventListener('mousedown', handleOutsideClick)
    } else {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showHistory, handleOutsideClick])

  const validUrls = urls.filter(u => u.trim().startsWith('http'))
  const canResearch = profile.companyName.trim() !== '' || validUrls.length > 0

  const handleResearch = async () => {
    if (!canResearch) return
    setIsResearching(true)
    setCompanyInfo(null)

    // 調査実行時に会社名をhistoryへ保存
    const valuesToSave: string[] = []
    if (profile.companyName.trim()) valuesToSave.push(profile.companyName.trim())
    validUrls.forEach(u => valuesToSave.push(u))
    if (valuesToSave.length > 0) {
      setHistory(prev => {
        let next = [...prev]
        // 複数ある場合は先頭からまとめて追加
        for (let i = valuesToSave.length - 1; i >= 0; i--) {
          next = addToHistory(next, valuesToSave[i])
        }
        return next
      })
    }

    try {
      const res = await axios.post<CompanyInfo>('/api/interview/company-research', {
        company_name: profile.companyName,
        urls: validUrls,
      })
      setCompanyInfo(res.data)
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '企業情報の取得に失敗しました。会社名またはURLを確認してください。'
      alert(msg)
    } finally {
      setIsResearching(false)
    }
  }

  const set = (key: keyof UserProfile, value: string) =>
    setProfile(prev => ({ ...prev, [key]: value }))

  const isUserStepValid = profile.name.trim() !== ''

  const handleSelectHistory = (value: string) => {
    if (value.startsWith('http')) {
      // URLの場合は最初の空URLスロットに入れる
      const next = [...urls]
      const emptyIdx = next.findIndex(u => !u.trim())
      if (emptyIdx !== -1) {
        next[emptyIdx] = value
      } else {
        next[0] = value
      }
      setUrls(next)
    } else {
      set('companyName', value)
    }
    setShowHistory(false)
  }

  const handleDeleteHistory = (value: string) => {
    setHistory(prev => prev.filter(h => h !== value))
  }

  const handleClearAllHistory = () => {
    setHistory([])
    setShowHistory(false)
  }

  return (
    <div className="setup-form-page">
      <header className="setup-form-header">
        <button className="back-btn" onClick={onBack}>← 戻る</button>
        <div className="setup-steps">
          <span className={`step ${step === 'user' ? 'active' : 'done'}`}>① あなたの情報</span>
          <span className="step-arrow">›</span>
          <span className={`step ${step === 'company' ? 'active' : ''}`}>
            ② 企業情報
          </span>
        </div>
      </header>

      <div className="setup-form-body">
        {step === 'user' && (
          <div className="form-section">
            <h2>あなたの情報を入力</h2>
            <p className="form-desc">入力した内容をもとにAIがあなたに合った回答を生成します</p>

            <div className="form-grid">
              <div className="form-field">
                <label>名前 <span className="required">必須</span></label>
                <input
                  type="text"
                  placeholder="例：山田 太郎"
                  value={profile.name}
                  onChange={e => set('name', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>大学名</label>
                <input
                  type="text"
                  placeholder="例：○○大学"
                  value={profile.university}
                  onChange={e => set('university', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>学部・学科</label>
                <input
                  type="text"
                  placeholder="例：経済学部 経済学科"
                  value={profile.faculty}
                  onChange={e => set('faculty', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>学年</label>
                <select value={profile.grade} onChange={e => set('grade', e.target.value)}>
                  {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="form-field full">
              <label>あなたの強み・特技</label>
              <textarea
                placeholder="例：リーダーシップがある、粘り強く問題解決できる、データ分析が得意"
                value={profile.strength}
                onChange={e => set('strength', e.target.value)}
                rows={3}
              />
            </div>

            <div className="form-field full">
              <label>学生時代に頑張ったこと・経験（ガクチカ）</label>
              <textarea
                placeholder="例：サークルでイベント運営を担当し、100名規模の文化祭を企画・実行した。参加者数を前年比150%に増加させた。"
                value={profile.experience}
                onChange={e => set('experience', e.target.value)}
                rows={4}
              />
            </div>

            <button
              className="btn-next-step"
              onClick={() => setStep('company')}
              disabled={!isUserStepValid}
            >
              次へ：企業情報 →
            </button>
          </div>
        )}

        {step === 'company' && (
          <div className="form-section">
            <h2>面接先企業の情報</h2>
            <p className="form-desc">企業情報を入れると志望動機など企業特有の質問にも対応できます（任意）</p>

            <div className="form-grid">
              <div className="form-field company-field">
                <label>会社名</label>
                <div className="company-input-row" ref={companyInputRef}>
                  <div className="company-input-with-history">
                    <input
                      type="text"
                      placeholder="例：株式会社○○"
                      value={profile.companyName}
                      onChange={e => set('companyName', e.target.value)}
                      onFocus={() => setShowHistory(true)}
                      autoComplete="off"
                    />
                    {showHistory && history.length > 0 && (
                      <HistoryDropdown
                        history={history}
                        onSelect={handleSelectHistory}
                        onDelete={handleDeleteHistory}
                        onClearAll={handleClearAllHistory}
                      />
                    )}
                  </div>
                  <button
                    className="btn-research"
                    onClick={handleResearch}
                    disabled={!canResearch || isResearching}
                  >
                    {isResearching ? '調査中...' : '企業を調べる'}
                  </button>
                </div>
              </div>

              <div className="form-field full url-inputs">
                <label>企業HP・採用ページのURL（任意・貼るとAIが自動解析。URLなしでも会社名だけで調査可能）</label>
                {urls.map((url, i) => (
                  <input
                    key={i}
                    type="url"
                    placeholder={i === 0 ? '例：https://www.toyota.co.jp/about/' : '例：採用ページURL（任意）'}
                    value={url}
                    onChange={e => {
                      const next = [...urls]
                      next[i] = e.target.value
                      setUrls(next)
                    }}
                  />
                ))}
              </div>

              <div className="form-field">
                <label>業界</label>
                <input
                  type="text"
                  placeholder="例：IT・コンサルティング"
                  value={profile.industry}
                  onChange={e => set('industry', e.target.value)}
                />
              </div>

              <div className="form-field full">
                <label>志望職種・部署</label>
                <input
                  type="text"
                  placeholder="例：エンジニア・営業・マーケティング"
                  value={profile.jobType}
                  onChange={e => set('jobType', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>応募職種（AIヒントをパーソナライズ）</label>
                <input
                  type="text"
                  placeholder="例：営業職・バックエンドエンジニア・総合職"
                  value={profile.jobTitle}
                  onChange={e => set('jobTitle', e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>面接タイプ</label>
                <select
                  value={profile.interviewTypePref}
                  onChange={e => set('interviewTypePref', e.target.value)}
                >
                  {INTERVIEW_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="form-field full">
              <label>この会社を志望する理由（キーワード）</label>
              <textarea
                placeholder="例：グローバルに活躍できる、技術力が高い、社会課題の解決に取り組んでいる"
                value={profile.motivation}
                onChange={e => set('motivation', e.target.value)}
                rows={3}
              />
            </div>

            {companyInfo && (
              <div className="company-info-panel">
                <h3>企業情報レポート：{profile.companyName}</h3>
                <div className="company-info-grid">
                  <div className="ci-item">
                    <span className="ci-label">概要</span>
                    <p>{companyInfo.overview}</p>
                  </div>
                  <div className="ci-item">
                    <span className="ci-label">主な事業</span>
                    <p>{companyInfo.business}</p>
                  </div>
                  <div className="ci-item">
                    <span className="ci-label">企業文化・社風</span>
                    <p>{companyInfo.culture}</p>
                  </div>
                  <div className="ci-item">
                    <span className="ci-label">強み</span>
                    <p>{companyInfo.strengths}</p>
                  </div>
                  <div className="ci-item">
                    <span className="ci-label">最近の動向</span>
                    <p>{companyInfo.recent_topics}</p>
                  </div>
                  <div className="ci-item highlight">
                    <span className="ci-label">面接対策ポイント</span>
                    <p>{companyInfo.interview_tips}</p>
                  </div>

                  {companyInfo.review_summary && (
                    <div className="ci-item review">
                      <span className="ci-label">社員・元社員の口コミまとめ</span>
                      <p>{companyInfo.review_summary}</p>
                      {companyInfo.review_sources && companyInfo.review_sources.length > 0 && (
                        <div className="source-links">
                          <span className="source-label">口コミ元：</span>
                          {companyInfo.review_sources.map((s, i) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="source-link">
                              {s.title.slice(0, 30)}...
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {companyInfo.sources && companyInfo.sources.length > 0 && (
                  <div className="sources-section">
                    <span className="sources-label">参考ソース：</span>
                    <div className="sources-list">
                      {companyInfo.sources.map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="source-chip">
                          {s.title.slice(0, 40)}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mode-buttons">
              <button
                className="btn-primary"
                onClick={() => {
                  onStart(profile)
                }}
              >
                <span className="btn-icon">🎙️</span>
                <div>
                  <div className="btn-title">リアルタイム補助を開始</div>
                  <div className="btn-sub">本番面接中にAIが回答を表示</div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
