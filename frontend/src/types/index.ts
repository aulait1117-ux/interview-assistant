export type InterviewType = '面接アシスト'
export type AppMode = 'home' | 'setup' | 'realtime' | 'feedback'

export interface UserProfile {
  // 自分の情報
  name: string
  university: string
  faculty: string
  grade: string
  strength: string
  experience: string
  selfPR: string
  weakness: string
  careerVision: string
  skills: string
  partTimeWork: string
  // 企業・面接情報
  companyName: string
  industry: string
  jobType: string
  motivation: string
  // パーソナライズ
  jobTitle: string
  interviewTypePref: string
  // 企業研究AIサマリー（調査後に自動設定）
  companyResearchTips?: string
}

export interface HintResponse {
  answer: string
}

// /api/interview/hint（非ストリーム版）が返すリッチな回答形式
export interface RichHintResponse {
  answer_30s: string
  answer_60s: string
  short_answer: string
  key_points: string[]
  follow_up_questions: string[]
  used_info: {
    personal: string
    company: string
    registered_answer: string
  }
  caution?: string | null
  mode?: 'ai' | 'registered' | 'hybrid' | null
  match_category?: string | null
  match_reason?: string | null
}


export interface SessionFeedback {
  overall_score: number
  summary: string
  strengths: string[]
  improvements: string[]
  action_items: string[]
}

export interface HistoryItem {
  session_id: string
  interview_type: InterviewType
  created_at: string
  overall_feedback: string | null
  qa_count: number
  avg_score: number | null
}
