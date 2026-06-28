from fastapi import APIRouter, Depends, HTTPException
from aiosqlite import Connection
from ..database import get_db
from ..models import SessionFeedbackRequest, SessionFeedbackResponse
from ..services import claude_service

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("/session", response_model=SessionFeedbackResponse)
async def get_session_feedback(req: SessionFeedbackRequest, db: Connection = Depends(get_db)):
    cursor = await db.execute(
        "SELECT interview_type FROM sessions WHERE id = ?",
        (req.session_id,),
    )
    session = await cursor.fetchone()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    interview_type = session[0]

    cursor = await db.execute(
        "SELECT question, user_answer, score FROM qa_pairs WHERE session_id = ? ORDER BY created_at",
        (req.session_id,),
    )
    rows = await cursor.fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No Q&A pairs found for this session")

    qa_pairs = [{"question": r[0], "user_answer": r[1], "score": r[2]} for r in rows]

    result = await claude_service.generate_session_feedback(qa_pairs, interview_type)

    await db.execute(
        "UPDATE sessions SET overall_feedback = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?",
        (result.get("summary"), req.session_id),
    )
    await db.commit()

    return SessionFeedbackResponse(**result)


@router.get("/history")
async def get_history(db: Connection = Depends(get_db)):
    cursor = await db.execute(
        """SELECT s.id, s.interview_type, s.created_at, s.overall_feedback,
                  COUNT(q.id) as qa_count,
                  AVG(q.score) as avg_score
           FROM sessions s
           LEFT JOIN qa_pairs q ON s.id = q.session_id
           GROUP BY s.id
           ORDER BY s.created_at DESC
           LIMIT 20""",
    )
    rows = await cursor.fetchall()
    return [
        {
            "session_id": r[0],
            "interview_type": r[1],
            "created_at": r[2],
            "overall_feedback": r[3],
            "qa_count": r[4],
            "avg_score": round(r[5], 1) if r[5] else None,
        }
        for r in rows
    ]
