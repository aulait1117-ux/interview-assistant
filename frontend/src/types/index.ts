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
  // 企業・面接情報
  companyName: string
  industry: string
  jobType: string
  motivation: string
}

export interface HintResponse {
  answer: string
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
