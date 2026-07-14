from fastapi import APIRouter, Depends, HTTPException
from aiosqlite import Connection
from database import get_db
from models import SessionFeedbackRequest, SessionFeedbackResponse
from routes.auth import get_current_user
from services import claude_service

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

# 2026-07-14、品質管理部の独立レビューで発見した認証欠如の修正。
# 修正前、この2つのエンドポイントは認証デコレータもユーザー絞り込みも無く、
# session_idを渡すだけで他人の面接の質問・本人の回答・スコアが読めた。/historyに至っては
# 全ユーザーの直近20セッションを無条件で返していた。面接の回答は個人情報そのものであり、
# 決済・音声保存が稼働中の本番でこの状態だった。
# 対策：①ログイン必須（get_current_user）②自分のセッションのみ（user_idで絞る）。
# セッションはinterview.pyのcreate_sessionが必ずuser_idを入れて作るので、絞り込みで
# 正規の機能が壊れることはない（user_idがNULLの旧データのみ見えなくなるが、
# 持ち主を証明できない記録なので見せない方が正しい）。


@router.post("/session", response_model=SessionFeedbackResponse)
async def get_session_feedback(
    req: SessionFeedbackRequest,
    db: Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    cursor = await db.execute(
        "SELECT interview_type FROM sessions WHERE id = ? AND user_id = ?",
        (req.session_id, user["id"]),
    )
    session = await cursor.fetchone()
    # 他人のセッションIDを指定された場合も404で返す（403だと「そのIDは存在する」と
    # 教えることになり、IDの総当たりで他人の面接の存在を確認されるため）
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
        "UPDATE sessions SET overall_feedback = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
        (result.get("summary"), req.session_id, user["id"]),
    )
    await db.commit()

    return SessionFeedbackResponse(**result)


@router.get("/history")
async def get_history(
    db: Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    cursor = await db.execute(
        """SELECT s.id, s.interview_type, s.created_at, s.overall_feedback,
                  COUNT(q.id) as qa_count,
                  AVG(q.score) as avg_score
           FROM sessions s
           LEFT JOIN qa_pairs q ON s.id = q.session_id
           WHERE s.user_id = ?
           GROUP BY s.id
           ORDER BY s.created_at DESC
           LIMIT 20""",
        (user["id"],),
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
