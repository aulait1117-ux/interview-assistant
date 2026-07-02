from pydantic import BaseModel, field_validator
from typing import Optional, List


class HintRequest(BaseModel):
    session_id: str
    question: str
    interview_type: str
    user_background: Optional[str] = None
    job_title: Optional[str] = None
    interview_type_pref: Optional[str] = None  # 1次面接 / 2次面接 / 最終面接 / GD / その他
    forced_mode: Optional[str] = None  # 'ai' | 'registered' | 'hybrid' — None=自動検出

    @field_validator('question')
    @classmethod
    def question_length(cls, v: str) -> str:
        if len(v) > 500:
            raise ValueError('質問は500文字以内にしてください')
        return v

    @field_validator('user_background')
    @classmethod
    def background_length(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 3000:
            return v[:3000]
        return v


class UsedInfo(BaseModel):
    personal: str
    company: str
    registered_answer: str


class HintResponse(BaseModel):
    answer_30s: str
    answer_60s: str
    short_answer: str
    key_points: List[str]
    follow_up_questions: List[str]
    used_info: UsedInfo
    caution: Optional[str] = None
    mode: Optional[str] = None
    match_category: Optional[str] = None
    match_reason: Optional[str] = None


class PracticeEvalRequest(BaseModel):
    session_id: str
    question: str
    user_answer: str
    interview_type: str


class PracticeEvalResponse(BaseModel):
    score: int
    feedback: str
    improved_answer: str
    points: List[str]


class SessionCreateRequest(BaseModel):
    interview_type: str
    user_background: Optional[str] = None


class SessionCreateResponse(BaseModel):
    session_id: str


class SessionFeedbackRequest(BaseModel):
    session_id: str


class QAPair(BaseModel):
    question: str
    user_answer: Optional[str]
    score: Optional[int]


class SessionFeedbackResponse(BaseModel):
    overall_score: int
    summary: str
    strengths: List[str]
    improvements: List[str]
    action_items: List[str]


class SaveAnswerRequest(BaseModel):
    session_id: str
    question: str
    user_answer: Optional[str] = None
    ai_hints: Optional[str] = None
    score: Optional[int] = None
    feedback: Optional[str] = None
