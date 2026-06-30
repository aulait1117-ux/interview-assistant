from pydantic import BaseModel
from typing import Optional, List


class HintRequest(BaseModel):
    session_id: str
    question: str
    interview_type: str
    user_background: Optional[str] = None
    job_title: Optional[str] = None
    interview_type_pref: Optional[str] = None  # 1次面接 / 2次面接 / 最終面接 / GD / その他


class HintResponse(BaseModel):
    answer: str
    short_answer: str
    key_points: List[str]
    caution: Optional[str] = None


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
