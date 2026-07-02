import re
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


# ─────────────────────────────────────────────
# 音声品質チェック・即時回答パターン
# ─────────────────────────────────────────────

def _is_recognizable(text: str) -> bool:
    """Whisper出力が意味のある日本語かチェック。短すぎ・日本語ほぼなし → False"""
    if not text or len(text.strip()) < 4:
        return False
    jp_chars = len(re.findall(r'[぀-鿿一-鿿]', text))
    return jp_chars >= 2


# よくある質問 → 即時表示する答え方の骨格
_QUICK_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'自己紹介|自己PR|自己ピーアール'),
     '📋 ① 氏名・大学 → ② 専攻・活動 → ③ 強み → ④ 入社後の抱負'),
    (re.compile(r'強み|長所|聴者|攻め'),
     '📋 ① 強みを一言で → ② 根拠エピソード（具体的数字） → ③ 仕事への活かし方'),
    (re.compile(r'弱み|短所|単純|悪み'),
     '📋 ① 弱みを正直に → ② 克服への取り組み → ③ 成長の実感'),
    (re.compile(r'強みと弱み|長所と短所|聴者と単純|長短'),
     '📋 強み: ① 一言 → ② エピソード → ③ 活かし方 ／ 弱み: ① 正直に → ② 改善取り組み'),
    (re.compile(r'志望動機|なぜ.*志望|志望した理由'),
     '📋 ① 業界選択の理由 → ② この企業を選んだ理由 → ③ 職種の理由 → ④ 入社後ビジョン'),
    (re.compile(r'ガクチカ|学生時代.*力|力を入れ'),
     '📋 ① 取り組んだこと → ② 目標・課題 → ③ 具体的な行動・工夫 → ④ 結果・学び'),
    (re.compile(r'5年後|10年後|将来.*ビジョン|キャリア'),
     '📋 ① 短期目標（1〜3年） → ② 中期目標（5年） → ③ 会社での貢献イメージ'),
    (re.compile(r'チーム|リーダー|協力|グループ'),
     '📋 ① 状況・自分の役割 → ② 課題・対立 → ③ 行動・工夫 → ④ 結果・学び'),
    (re.compile(r'失敗|挫折|困難.*乗り越え'),
     '📋 ① 失敗の状況（正直に） → ② 原因分析 → ③ 立て直しの行動 → ④ 得た教訓'),
    (re.compile(r'逆質問|質問はあり|何か.*質問'),
     '📋 業務内容・チームの雰囲気・成長環境 について具体的に聞く'),
    (re.compile(r'転職.*理由|前.*職|退職'),
     '📋 ① ネガティブを避け前向きな理由 → ② スキルアップ・挑戦したい領域 → ③ 御社でやりたいこと'),
    (re.compile(r'アルバイト|インターン|バイト'),
     '📋 ① 何をしたか → ② 工夫・頑張り → ③ 得たスキル・気づき → ④ 仕事への接続'),
]


def _get_quick_hint(text: str) -> str | None:
    for pattern, hint in _QUICK_PATTERNS:
        if pattern.search(text):
            return hint
    return None


@router.post("/session", response_model=SessionCreateResponse)
async def create_session(
    req: SessionCreateRequest,
    db: Connection = Depends(get_db),
    user=Depends(get_current_user),
):
    session_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO sessions (id, user_id, interview_type, user_background) VALUES (?, ?, ?, ?)",
        (session_id, user["id"], req.interview_type, req.user_background),
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
        job_title=req.job_title,
        interview_type_pref=req.interview_type_pref,
    )
    await db.execute(
        "INSERT INTO qa_pairs (id, session_id, question, ai_hints) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), req.session_id, req.question, str(result.get("hints", []))),
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

    # このセッション内で既に使われた登録回答カテゴリを取得（同一エピソードの使い回し対策）
    cursor = await db.execute(
        "SELECT DISTINCT category FROM qa_pairs WHERE session_id = ? AND category IS NOT NULL AND category != ''",
        (req.session_id,),
    )
    used_categories = [row[0] for row in await cursor.fetchall()]

    async def event_generator():
        full_text = ""
        async for chunk in claude_service.generate_hints_stream(
            question=req.question,
            interview_type=req.interview_type,
            user_background=req.user_background,
            job_title=req.job_title,
            interview_type_pref=req.interview_type_pref,
            forced_mode=req.forced_mode,
            used_categories=used_categories,
        ):
            full_text += chunk
            yield f"data: {chunk}\n\n"

        # METAからモード・カテゴリを抽出して保存
        meta_m = re.match(r'^##META:([^|#]*)\|([^|#]*)\|', full_text)
        hint_used = meta_m.group(1) if meta_m else 'ai'
        category = meta_m.group(2) if meta_m else ''

        # ストリーミング完了後に DB 保存
        await db.execute(
            "INSERT INTO qa_pairs (id, session_id, question, ai_hints, hint_used, category) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), req.session_id, req.question, full_text, hint_used, category),
        )
        await db.commit()
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/overlay-hint-stream")
async def overlay_hint_stream(req: HintRequest):
    """オーバーレイ専用: ローカルアプリのため認証なしでヒントを生成"""
    from routes.audio_capture import _user_background, _job_title, _interview_type_pref
    user_bg = req.user_background or (_user_background if _user_background else None)
    job_title = req.job_title or (_job_title if _job_title else None)
    interview_type_pref = req.interview_type_pref or (_interview_type_pref if _interview_type_pref else None)

    async def event_generator():
        # 音声認識が不十分なら Claude を呼ばずに即返答（コスト節約）
        if not _is_recognizable(req.question):
            yield "data: 🎙️ 聞き取れませんでした。もう少し大きな声でお話しください。\n\n"
            yield "data: [DONE]\n\n"
            return

        # よくある質問なら答え方の骨格を先出し（即時表示）
        quick_hint = _get_quick_hint(req.question)
        if quick_hint:
            yield f"data: {quick_hint}\n\n"
            yield "data: \n\n"

        try:
            async for chunk in claude_service.generate_hints_stream(
                question=req.question,
                interview_type=req.interview_type,
                user_background=user_bg,
                job_title=job_title,
                interview_type_pref=interview_type_pref,
                forced_mode=req.forced_mode,
            ):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            # サーバー側ログには詳細を残すが、ユーザーには内部情報を含まない汎用メッセージのみ返す
            print(f"[overlay-hint-stream] エラー詳細: {type(e).__name__}: {e}")
            yield "data: ⚠️ ヒントの生成に失敗しました。もう一度お試しください。\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
