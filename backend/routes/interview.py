import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from aiosqlite import Connection
from database import get_db
from fastapi import Query
from pydantic import BaseModel
from models import (
    HintRequest, HintResponse,
    SessionCreateRequest, SessionCreateResponse,
    SaveAnswerRequest,
)

class CompanyResearchRequest(BaseModel):
    company_name: str
    urls: list[str]
from services import claude_service
from routes.auth import get_current_user
from services.auth_service import PLANS

router = APIRouter(prefix="/api/interview", tags=["interview"])


@router.post("/session", response_model=SessionCreateResponse)
async def create_session(req: SessionCreateRequest, db: Connection = Depends(get_db)):
    session_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO sessions (id, interview_type) VALUES (?, ?)",
        (session_id, req.interview_type),
    )
    await db.commit()
    return SessionCreateResponse(session_id=session_id)


@router.post("/hint", response_model=HintResponse)
async def get_hint(
    req: HintRequest,
    db: Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    # 残り時間チェック（管理者はスキップ）
    if not user.get("is_admin"):
        plan_info = PLANS.get(user["plan"], PLANS["free"])
        minutes_limit = plan_info["minutes"]
        minutes_used = user["trial_minutes_used"]
        minutes_left = max(0, minutes_limit - minutes_used)

        if minutes_left == 0:
            raise HTTPException(
                status_code=403,
                detail="利用可能な時間が終了しました。プランをアップグレードしてください。",
            )

    result = await claude_service.generate_hints(
        question=req.question,
        interview_type=req.interview_type,
        user_background=req.user_background,
    )
    await db.execute(
        "INSERT INTO qa_pairs (session_id, question, ai_hints) VALUES (?, ?, ?)",
        (req.session_id, req.question, str(result.get("hints", []))),
    )
    await db.commit()
    return HintResponse(**result)


@router.post("/hint-stream")
async def get_hint_stream(
    req: HintRequest,
    db: Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    # 残り時間チェック（管理者はスキップ）
    if not user.get("is_admin"):
        plan_info = PLANS.get(user["plan"], PLANS["free"])
        minutes_limit = plan_info["minutes"]
        minutes_used = user["trial_minutes_used"]
        minutes_left = max(0, minutes_limit - minutes_used)

        if minutes_left == 0:
            raise HTTPException(
                status_code=403,
                detail="利用可能な時間が終了しました。プランをアップグレードしてください。",
            )

    async def event_generator():
        full_text = ""
        async for chunk in claude_service.generate_hints_stream(
            question=req.question,
            interview_type=req.interview_type,
            user_background=req.user_background,
        ):
            full_text += chunk
            yield f"data: {chunk}\n\n"

        # ストリーミング完了後に DB 保存
        await db.execute(
            "INSERT INTO qa_pairs (session_id, question, ai_hints) VALUES (?, ?, ?)",
            (req.session_id, req.question, full_text),
        )
        await db.commit()
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/overlay-hint-stream")
async def overlay_hint_stream(req: HintRequest):
    """オーバーレイ専用: ローカルアプリのため認証なしでヒントを生成"""
    async def event_generator():
        async for chunk in claude_service.generate_hints_stream(
            question=req.question,
            interview_type=req.interview_type,
            user_background=req.user_background,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/save-answer")
async def save_answer(req: SaveAnswerRequest, db: Connection = Depends(get_db)):
    await db.execute(
        """UPDATE qa_pairs SET user_answer = ?, score = ?, feedback = ?
           WHERE session_id = ? AND question = ?
           AND id = (SELECT MAX(id) FROM qa_pairs WHERE session_id = ? AND question = ?)""",
        (req.user_answer, req.score, req.feedback,
         req.session_id, req.question, req.session_id, req.question),
    )
    await db.commit()
    return {"status": "ok"}


@router.post("/company-research")
async def company_research(req: CompanyResearchRequest):
    result = await claude_service.research_company_from_urls(req.company_name, req.urls)
    return result


@router.post("/end-session")
async def end_session(session_id: str, db: Connection = Depends(get_db)):
    await db.execute(
        "UPDATE sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?",
        (session_id,),
    )
    await db.commit()
    return {"status": "ok"}
